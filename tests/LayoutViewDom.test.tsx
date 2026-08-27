// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LayoutViewDom } from "../src/LayoutViewDom";
import { useLayout } from "../src/layoutStore";
import { buildInitialScreen } from "../src/screen";
import * as G from "../src/geometry";

function resetLayout() {
  useLayout.setState({
    screen: buildInitialScreen(),
    mode: "idle",
    status: "",
    cornerStart: { x: 0, y: 0 },
    srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false, ctrl: false,
    resize: null, dock: null, maximizedId: null,
    past: [], future: [],
  });
}
beforeEach(() => {
  resetLayout();
  cleanup();
});

describe("LayoutViewDom 渲染结构", () => {
  it("渲染全部区域、内部分界线与角标", () => {
    const { container } = render(<LayoutViewDom />);
    expect(container.querySelectorAll(".tl-area-box")).toHaveLength(3);
    expect(container.querySelectorAll(".tl-asplit")).toHaveLength(3); // 3 条非 border 内部分界线
    expect(container.querySelectorAll(".tl-corner")).toHaveLength(8); // 8 个唯一坐标角点
    expect(container.textContent).toContain("编辑器");
    expect(container.textContent).toContain("目录");
    expect(container.textContent).toContain("属性");
  });
  it("theme config 施加 --tl-* CSS 变量", () => {
    const { container } = render(<LayoutViewDom theme={{ spacing: { regionGap: 9 } }} />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("9px");
  });
});

describe("LayoutViewDom 交互入口", () => {
  it("角标 mousedown 进入 corner 模式", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-corner")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("corner");
  });
  it("分界线 mousedown 进入 resizing 模式", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-asplit")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("resizing");
  });
  it("区域头部 mousedown 进入 docking 模式", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-ahead")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("docking");
  });
  it("双击头部切换最大化", () => {
    const { container } = render(<LayoutViewDom />);
    const firstHead = container.querySelector(".tl-ahead")!;
    fireEvent.doubleClick(firstHead);
    const mid = useLayout.getState();
    expect(mid.maximizedId).not.toBeNull();
    // 再次双击恢复
    fireEvent.doubleClick(container.querySelector(".tl-ahead")!);
    expect(useLayout.getState().maximizedId).toBeNull();
  });
  it("最大化后其他区域隐藏、目标铺满", () => {
    const { container } = render(<LayoutViewDom />);
    const areaId = useLayout.getState().screen.areas[0].id;
    act(() => { useLayout.getState().toggleMaximize(areaId); });
    const boxes = Array.from(container.querySelectorAll(".tl-area-box")) as HTMLElement[];
    const maxBox = boxes.find((b) => b.style.width === "100%")!;
    expect(maxBox).toBeTruthy();
    expect(boxes.filter((b) => b.style.display === "none")).toHaveLength(2);
  });
});

describe("LayoutViewDom 全局事件桥", () => {
  it("Escape 取消当前交互态", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-corner")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("corner");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useLayout.getState().mode).toBe("idle");
  });
  it("idle 时 Escape 退出最大化", () => {
    render(<LayoutViewDom />);
    useLayout.getState().toggleMaximize(1);
    expect(useLayout.getState().maximizedId).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useLayout.getState().maximizedId).toBeNull();
  });
  it("Tab 切换分割方向", () => {
    render(<LayoutViewDom />);
    useLayout.getState().beginCorner(1, { x: 0.3, y: 0.5 }, false);
    useLayout.getState().cornerMove(0.2, 0.5); // splitDir=V
    fireEvent.keyDown(window, { key: "Tab" });
    expect(useLayout.getState().splitDir).toBe("H");
  });
  it("Control 按下/抬起同步 ctrl 态", () => {
    render(<LayoutViewDom />);
    fireEvent.keyDown(window, { key: "Control" });
    expect(useLayout.getState().ctrl).toBe(true);
    fireEvent.keyUp(window, { key: "Control" });
    expect(useLayout.getState().ctrl).toBe(false);
  });
  it("非 idle 时右键阻止默认并取消", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-corner")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("corner");
    const ev = new MouseEvent("contextmenu", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(useLayout.getState().mode).toBe("idle");
  });
  it("pointermove 在 corner 模式驱动 cornerMove", () => {
    const { container } = render(<LayoutViewDom />);
    fireEvent.mouseDown(container.querySelector(".tl-corner")!, { button: 0 });
    expect(useLayout.getState().mode).toBe("corner");
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    // jsdom 下 getBoundingClientRect 为 0，坐标落入 NaN 分支但模式保持 corner
    expect(useLayout.getState().mode).toBe("corner");
  });
});

describe("LayoutViewDom 渲染插槽", () => {
  it("slots 接管区域头/角标/分界线/区域盒", () => {
    const { container } = render(
      <LayoutViewDom slots={{
        renderHeader: () => <b>自定义头</b>,
        renderCorner: () => <i>C</i>,
        renderEdge: () => <i>E</i>,
        renderArea: () => <span>AREA</span>,
      }} />,
    );
    expect(container.querySelectorAll(".tl-ahead b")).toHaveLength(3);
    expect(container.querySelectorAll(".tl-corner i")).toHaveLength(8);
    expect(container.querySelectorAll(".tl-asplit i")).toHaveLength(3);
    expect(container.querySelectorAll(".tl-area-layer span")).toHaveLength(3);
  });
  it("推导分界线不含舞台贴边线段(外框不可拖拽)", () => {
    const { container } = render(<LayoutViewDom />);
    // 舞台外框坐标(x∈{0,1} / y∈{0,1})不应出现可拖拽分界线
    const stuck = [...container.querySelectorAll<HTMLElement>(".tl-asplit")]
      .filter((n) => n.getAttribute("style")?.includes("calc(0% - 3px)") || n.getAttribute("style")?.includes("calc(100% - 3px)"));
    expect(stuck.length).toBe(0);
  });
});

describe("LayoutViewDom 分界线 hover 连通族高亮", () => {
  it("hover 一条被切分长线的任一段 → 同向连通族整条高亮，正交边不高亮", () => {
    // 构造：右侧 B、C 各垂直分割(不同 x) → 中横线 y=0.5538 被切成多段
    const s = useLayout.getState().screen;
    const byType = (t: string) => s.areas.find((a) => a.contentType === t)!;
    act(() => {
      G.split(s, byType("outline"), G.AXIS.V, 0.5);
      G.split(s, byType("properties"), G.AXIS.V, 0.4);
      useLayout.setState({ screen: { ...s } });
    });
    const { container } = render(<LayoutViewDom />);
    const hSegs = [...container.querySelectorAll<HTMLElement>('.tl-asplit[data-vertical="false"]')];
    const vSegs = [...container.querySelectorAll<HTMLElement>('.tl-asplit[data-vertical="true"]')];
    expect(hSegs.length).toBeGreaterThan(1); // 横线被 T 型点切分多段

    fireEvent.mouseEnter(hSegs[0]);
    const hot = container.querySelectorAll(".tl-asplit-hot");
    // 同向连通族整条高亮(所有横线段)，正交竖线不参与
    expect(hot.length).toBe(hSegs.length);
    expect(container.querySelectorAll('.tl-asplit-hot[data-vertical="true"]').length).toBe(0);
    expect(vSegs.every((n) => !n.classList.contains("tl-asplit-hot"))).toBe(true);
  });

  it("hover 时 renderEdge 仅在被 hover 的段收到 hovered=true", () => {
    const s = useLayout.getState().screen;
    const byType = (t: string) => s.areas.find((a) => a.contentType === t)!;
    act(() => {
      G.split(s, byType("outline"), G.AXIS.V, 0.5);
      G.split(s, byType("properties"), G.AXIS.V, 0.4);
      useLayout.setState({ screen: { ...s } });
    });
    const hoveredEdges = new Set<number>();
    const { container } = render(
      <LayoutViewDom slots={{ renderEdge: ({ edgeId, hovered }) => {
        if (hovered) hoveredEdges.add(edgeId);
        return null;
      } }} />,
    );
    const hSegs = [...container.querySelectorAll<HTMLElement>('.tl-asplit[data-vertical="false"]')];
    fireEvent.mouseEnter(hSegs[1]);
    // 只有一个段收到 hovered(true)；其他族内段(横线其余段)与竖线均不收到
    expect(hoveredEdges.size).toBe(1);
  });
});
