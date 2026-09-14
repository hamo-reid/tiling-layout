// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useEffect, useRef } from "react";
import { stagePointToMath, useLayoutGestureBridge } from "../src/useLayoutGestureBridge";
import { useLayout } from "../src/layoutStore";

/** 真实 store 快照(测试里会把 action 换成 spy,afterEach 还原) */
const REAL = { ...useLayout.getState() };

/** jsdom 无布局引擎:mock 出 100×100 舞台 */
const stageRect = {
  x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
  width: 100, height: 100,
  toJSON: () => ({}),
} as DOMRect;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(stageRect);
});
afterEach(() => {
  cleanup();
  useLayout.setState(REAL);
});

let capturedPt: ((e: { clientX: number; clientY: number }) => { x: number; y: number } | null) | null = null;
function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const pt = useLayoutGestureBridge(ref);
  // 捕获返回值供断言:在 effect 里写模块变量(渲染期写属副作用,react-hooks/globals 会拦)
  useEffect(() => { capturedPt = pt; }, [pt]);
  return <div ref={ref} data-testid="stage" />;
}

/** 用 spy 替换 store 的各类 action,并返回 spy 表(不动 get:handler 每次 getState 取最新) */
function installSpies() {
  const spies = {
    cornerMove: vi.fn(), resizeMove: vi.fn(), dockMove: vi.fn(),
    cornerUp: vi.fn(), endResize: vi.fn(), dockUp: vi.fn(),
    cancel: vi.fn(), toggleSplitDir: vi.fn(), setCtrl: vi.fn(), exitMaximize: vi.fn(),
  };
  useLayout.setState({ ...spies, mode: "idle", maximizedId: null });
  return spies;
}

describe("stagePointToMath", () => {
  it("stage 为 null → null", () => {
    expect(stagePointToMath(null, { clientX: 0, clientY: 0 })).toBeNull();
  });

  it("容器 0 尺寸 → null(防 Infinity/NaN 入库)", () => {
    const el = document.createElement("div");
    el.getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0 } as DOMRect);
    expect(stagePointToMath(el, { clientX: 0, clientY: 0 })).toBeNull();
  });

  it("正常换算:x 向右、y 向上翻转", () => {
    render(<Harness />);
    expect(capturedPt?.({ clientX: 25, clientY: 25 })).toEqual({ x: 0.25, y: 0.75 });
  });
});

describe("useLayoutGestureBridge 事件桥", () => {
  it("pointermove 按 mode 分派;mouseup 收束", () => {
    render(<Harness />);
    const s = installSpies();

    useLayout.setState({ mode: "corner" });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
    expect(s.cornerMove).toHaveBeenCalledWith(0.1, 0.9);

    useLayout.setState({ mode: "resizing" });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
    expect(s.resizeMove).toHaveBeenCalledWith(0.1, 0.9);

    useLayout.setState({ mode: "docking" });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 }));
    expect(s.dockMove).toHaveBeenCalledWith(0.1, 0.9);

    useLayout.setState({ mode: "idle" });
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10 })); // idle 不分派

    useLayout.setState({ mode: "corner" });
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
    expect(s.cornerUp).toHaveBeenCalledTimes(1);

    useLayout.setState({ mode: "resizing" });
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
    expect(s.endResize).toHaveBeenCalledTimes(1);

    useLayout.setState({ mode: "docking" });
    window.dispatchEvent(new MouseEvent("mouseup", { button: 0 }));
    expect(s.dockUp).toHaveBeenCalledTimes(1);

    // 非左键 mouseup 不触发
    window.dispatchEvent(new MouseEvent("mouseup", { button: 2 }));
    expect(s.dockUp).toHaveBeenCalledTimes(1);
  });

  it("Esc:手势中取消;idle 下退出最大化", () => {
    render(<Harness />);
    const s = installSpies();

    useLayout.setState({ mode: "corner" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.cancel).toHaveBeenCalledTimes(1);

    s.cancel.mockClear();
    useLayout.setState({ mode: "idle", maximizedId: 3 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(s.cancel).not.toHaveBeenCalled();
    expect(s.exitMaximize).toHaveBeenCalledTimes(1);
  });

  it("Tab 仅角标手势中劫持并切换方向", () => {
    render(<Harness />);
    const s = installSpies();

    useLayout.setState({ mode: "corner" });
    const tab = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    window.dispatchEvent(tab);
    expect(s.toggleSplitDir).toHaveBeenCalledTimes(1);
    expect(tab.defaultPrevented).toBe(true);

    useLayout.setState({ mode: "idle" });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(s.toggleSplitDir).toHaveBeenCalledTimes(1); // idle 不劫持
  });

  it("Control 按下/抬起 → setCtrl", () => {
    render(<Harness />);
    const s = installSpies();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    expect(s.setCtrl).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(s.setCtrl).toHaveBeenLastCalledWith(false);
  });

  it("右键上下文菜单在非 idle 时取消", () => {
    render(<Harness />);
    const s = installSpies();

    useLayout.setState({ mode: "corner" });
    const ctx = new MouseEvent("contextmenu", { cancelable: true });
    window.dispatchEvent(ctx);
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(ctx.defaultPrevented).toBe(true);

    s.cancel.mockClear();
    useLayout.setState({ mode: "idle" });
    window.dispatchEvent(new MouseEvent("contextmenu", { cancelable: true }));
    expect(s.cancel).not.toHaveBeenCalled();
  });

  it("blur / pointercancel 兜底取消", () => {
    render(<Harness />);
    const s = installSpies();

    useLayout.setState({ mode: "resizing" });
    window.dispatchEvent(new Event("blur"));
    expect(s.cancel).toHaveBeenCalledTimes(1);

    useLayout.setState({ mode: "docking" });
    window.dispatchEvent(new Event("pointercancel"));
    expect(s.cancel).toHaveBeenCalledTimes(2);
  });
});
