// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen as rtlScreen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Content, getContentTitle, registerContent } from "../src/registry";
import type { ContentProps } from "../src/registry";
import { clearAreaInstances, getAreaComponent, getComponentsByType } from "../src/areaInstances";
import { getAreaState, setAreaState, useAreaState } from "../src/areaStore";

beforeEach(() => {
  clearAreaInstances();
  useAreaState.setState({ map: {} });
  cleanup();
});

interface CounterState { count: number; label?: string }
function CounterPanel({ areaId, state, setState }: ContentProps<CounterState>) {
  return (
    <div>
      <span data-testid="area">{areaId}</span>
      <span data-testid="count">{state.count}</span>
      <span data-testid="label">{state.label}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); setState({ count: (state.count ?? 0) + 1 }); }}>
        inc
      </button>
    </div>
  );
}

describe("Content 挂载/卸载注册", () => {
  it("挂载时把内容容器注册进 areaInstances", () => {
    render(<Content type="viewport" areaId={1} />);
    const info = getAreaComponent(1);
    expect(info).not.toBeNull();
    expect(info?.contentType).toBe("viewport");
    expect(info?.el.tagName).toBe("DIV");
    expect(info?.el.className).toContain("tl-area-content");
  });
  it("卸载后查询不到", () => {
    const { unmount } = render(<Content type="viewport" areaId={2} />);
    expect(getAreaComponent(2)).not.toBeNull();
    unmount();
    expect(getAreaComponent(2)).toBeNull();
  });
  it("getComponentsByType 按 contentType 过滤且按 areaId 升序", () => {
    render(<Content type="viewport" areaId={5} />);
    render(<Content type="outline" areaId={6} />);
    render(<Content type="viewport" areaId={3} />);
    expect(getComponentsByType("viewport").map((c) => c.areaId)).toEqual([3, 5]);
    expect(getComponentsByType("outline").map((c) => c.areaId)).toEqual([6]);
  });
});

describe("registerContent 注册与实例状态注入", () => {
  it("注册类型挂载时注入默认实例状态，并以类型化 state 渲染", () => {
    registerContent({
      type: "counter_t",
      defaults: { count: 7, label: "hi" },
      Comp: CounterPanel,
    });
    render(<Content type="counter_t" areaId={9} />);
    expect(getAreaState(9, "counter_t").count).toBe(7);
    expect(rtlScreen.getByTestId("count")).toHaveTextContent("7");
    expect(rtlScreen.getByTestId("label")).toHaveTextContent("hi");
  });
  it("setState 增量更新本区域状态并触发重渲染", () => {
    registerContent({ type: "counter_u", defaults: { count: 0 }, Comp: CounterPanel });
    render(<Content type="counter_u" areaId={11} />);
    fireEvent.click(rtlScreen.getByText("inc"));
    expect(getAreaState(11, "counter_u").count).toBe(1);
    expect(rtlScreen.getByTestId("count")).toHaveTextContent("1");
  });
  it("该类型槽位已有条目时不覆盖(defaults 只在首次注入)", () => {
    registerContent({ type: "counter_p", defaults: { count: 1 }, Comp: CounterPanel });
    setAreaState(12, "counter_p", { count: 99 });
    render(<Content type="counter_p" areaId={12} />);
    expect(getAreaState(12, "counter_p").count).toBe(99);
  });
  it("同区域切换类型：各类型状态分槽隔离，切回即恢复", () => {
    registerContent({ type: "iso_a", defaults: { count: 10 }, Comp: CounterPanel });
    registerContent({ type: "iso_b", defaults: { count: 20 }, Comp: CounterPanel });
    const { rerender } = render(<Content type="iso_a" areaId={40} />);
    expect(rtlScreen.getByTestId("count")).toHaveTextContent("10");
    fireEvent.click(rtlScreen.getByText("inc")); // a 的 count → 11
    rerender(<Content type="iso_b" areaId={40} />);
    expect(rtlScreen.getByTestId("count")).toHaveTextContent("20"); // b 用自己的 defaults
    rerender(<Content type="iso_a" areaId={40} />);
    expect(rtlScreen.getByTestId("count")).toHaveTextContent("11"); // 切回 a，状态还在
  });
  it("未注册类型显示通用面板且不注入状态", () => {
    const { container } = render(<Content type="unknown_xyz" areaId={10} />);
    expect(getAreaState(10, "unknown_xyz")).toEqual({});
    expect(container.textContent).toContain("unknown_xyz");
    expect(container.textContent).toContain("通用面板");
  });
  it("同一组件挂载到多个区域，state 按 areaId 隔离", () => {
    registerContent({ type: "counter_m", defaults: { count: 0 }, Comp: CounterPanel });
    render(<Content type="counter_m" areaId={21} />);
    render(<Content type="counter_m" areaId={22} />);
    const incs = rtlScreen.getAllByText("inc");
    fireEvent.click(incs[0]);
    expect(getAreaState(21, "counter_m").count).toBe(1);
    expect(getAreaState(22, "counter_m").count).toBe(0);
  });
});

describe("getContentTitle 标题解析", () => {
  it("优先注册 title，其次 CONTENT 表，最后 type 原文", () => {
    registerContent({ type: "titled_t", title: "自定义标题", Comp: () => null });
    expect(getContentTitle("titled_t")).toBe("自定义标题");
    expect(getContentTitle("outline")).toBe("目录"); // CONTENT 表回退
    expect(getContentTitle("no_where_t")).toBe("no_where_t"); // 原文回退
  });
});

describe("registerContent 生命周期回调", () => {
  it("onMount 在 defaults 注入后触发，onUnmount 卸载时成对触发", () => {
    const calls: string[] = [];
    registerContent({
      type: "lc_t",
      defaults: { count: 5 },
      Comp: CounterPanel,
      onMount: ({ areaId, contentType, el }) => {
        expect(el.className).toContain("tl-area-content"); // ctx.el 是内容容器
        expect(contentType).toBe("lc_t");
        calls.push(`mount:${areaId}:${getAreaState(areaId, "lc_t").count}`); // defaults 已注入
      },
      onUnmount: ({ areaId }) => calls.push(`unmount:${areaId}`),
    });
    const { unmount } = render(<Content type="lc_t" areaId={51} />);
    expect(calls).toEqual(["mount:51:5"]);
    unmount();
    expect(calls).toEqual(["mount:51:5", "unmount:51"]);
    expect(getAreaComponent(51)).toBeNull(); // 卸载后注册表已清
  });
  it("切换类型：旧类型 onUnmount 先于新类型 onMount，各触发一次", () => {
    const calls: string[] = [];
    registerContent({
      type: "lc_a", defaults: { count: 1 }, Comp: CounterPanel,
      onMount: () => calls.push("mount:a"),
      onUnmount: () => calls.push("unmount:a"),
    });
    registerContent({
      type: "lc_b", defaults: { count: 2 }, Comp: CounterPanel,
      onMount: () => calls.push("mount:b"),
      onUnmount: () => calls.push("unmount:b"),
    });
    const { rerender, unmount } = render(<Content type="lc_a" areaId={52} />);
    expect(calls).toEqual(["mount:a"]);
    rerender(<Content type="lc_b" areaId={52} />);
    expect(calls).toEqual(["mount:a", "unmount:a", "mount:b"]); // 旧卸载先于新挂载
    unmount();
    expect(calls).toEqual(["mount:a", "unmount:a", "mount:b", "unmount:b"]);
  });
  it("同一类型挂载到多个区域，回调按区域各自成对触发", () => {
    const mounted = new Set<number>();
    const unmounted: number[] = [];
    registerContent({
      type: "lc_m", defaults: { count: 0 }, Comp: CounterPanel,
      onMount: ({ areaId }) => { mounted.add(areaId); },
      onUnmount: ({ areaId }) => unmounted.push(areaId),
    });
    const { unmount } = render(
      <>
        <Content type="lc_m" areaId={61} />
        <Content type="lc_m" areaId={62} />
      </>,
    );
    expect([...mounted].sort()).toEqual([61, 62]);
    unmount();
    expect(unmounted.sort()).toEqual([61, 62]);
  });
});

describe("错误边界", () => {
  it("组件抛错只降级该面板，不影响同级区域", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Boom(): never {
        throw new Error("boom");
      }
      function Ok() {
        return <div className="tl-acontent">正常面板</div>;
      }
      registerContent({ type: "boom_t", Comp: Boom });
      registerContent({ type: "ok_t", Comp: Ok });
      const { container } = render(
        <>
          <Content type="boom_t" areaId={31} />
          <Content type="ok_t" areaId={32} />
        </>,
      );
      expect(container.textContent).toContain("面板已崩溃");
      expect(container.textContent).toContain("boom");
      expect(container.textContent).toContain("正常面板");
      // 注册表不受崩溃影响
      expect(getAreaComponent(31)?.contentType).toBe("boom_t");
    } finally {
      spy.mockRestore();
    }
  });
  it("切换类型后错误态重置，新组件正常渲染", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      function Boom(): never {
        throw new Error("early");
      }
      function Ok() {
        return <div className="tl-acontent">恢复面板</div>;
      }
      registerContent({ type: "boom2_t", Comp: Boom });
      registerContent({ type: "ok2_t", Comp: Ok });
      const { rerender, container } = render(<Content type="boom2_t" areaId={33} />);
      expect(container.textContent).toContain("面板已崩溃");
      rerender(<Content type="ok2_t" areaId={33} />);
      expect(container.textContent).toContain("恢复面板");
      expect(container.textContent).not.toContain("面板已崩溃");
    } finally {
      spy.mockRestore();
    }
  });
});
