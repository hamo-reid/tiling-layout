// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LayoutViewDom } from "../src/LayoutViewDom";
import { LayoutProvider } from "../src/LayoutProvider";
import { useLayout } from "../src/layoutStore";
import { useWorkspaces } from "../src/workspaces";
import { useAreaState } from "../src/areaStore";
import { useScene } from "../src/sceneStore";
import { buildInitialScreen } from "../src/screen";
import { collectSnapshot } from "../src/layoutData";
import { clearContentRegistry } from "../src/registry";
import { resetLayoutBootstrap } from "../src/initialLayout";

/** 与 LayoutViewDom.test 一致:mock 出真实舞台尺寸供 ptToMath 坐标桥 */
const stageRect = {
  x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 650,
  width: 1000, height: 650,
  toJSON: () => ({}),
} as DOMRect;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(stageRect);
});

function resetAll() {
  useLayout.setState({
    screen: buildInitialScreen(),
    mode: "idle", status: "",
    cornerStart: { x: 0, y: 0 }, lastPt: { x: 0, y: 0 },
    srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false, ctrl: false,
    resize: null, dock: null, maximizedId: null,
    past: [], future: [],
  });
  useAreaState.setState({ map: {} });
  useScene.setState({ mesh: { x: 0, rot: 0 } });
  const seedId = "layout-1";
  useWorkspaces.setState({
    list: [{ id: seedId, name: "General" }],
    data: { [seedId]: { snapshot: collectSnapshot(buildInitialScreen(), "General"), history: { past: [], future: [] } } },
    activeId: seedId,
  });
  clearContentRegistry();
  resetLayoutBootstrap();
}
beforeEach(() => {
  vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue(stageRect);
  resetAll();
  cleanup();
});

describe("LayoutViewDom 容器策略(positioning/flow)", () => {
  it("默认 absolute:data-positioning 为 absolute", () => {
    const { container } = render(<LayoutViewDom />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.dataset.positioning).toBe("absolute");
  });

  it("positioning=\"flow\" 打到 wrap 上(CSS 侧切换 normal-flow)", () => {
    const { container } = render(<LayoutViewDom positioning="flow" />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.dataset.positioning).toBe("flow");
  });

  it("style 透传到 wrap(自定义 padding/margin/背景)", () => {
    const { container } = render(<LayoutViewDom style={{ padding: 16, background: "#123" }} />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.padding).toBe("16px");
    expect(wrap.style.background).toBe("rgb(17, 34, 51)");
  });

  it("flow 模式父级 0 高时 console.warn 一次", () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 0, width: 1000, height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<LayoutViewDom positioning="flow" />);
    expect(warn).toHaveBeenCalledTimes(1);
    rerender(<LayoutViewDom positioning="flow" />); // 不重复警告
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("flow→absolute→flow 过渡不重复警告(守卫有效)", () => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 0, width: 1000, height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = render(<LayoutViewDom positioning="flow" />);
    expect(warn).toHaveBeenCalledTimes(1);
    rerender(<LayoutViewDom positioning="absolute" />); // 切走
    rerender(<LayoutViewDom positioning="flow" />);     // 切回:守卫已置位,不再报
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("LayoutViewDom 主题变量(partial 穿透修复)", () => {
  it("theme 只内联显式键:未配置键不写内联(不再遮蔽 Provider)", () => {
    const { container } = render(<LayoutViewDom theme={{ sizing: { corner: 20 } }} />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-corner")).toBe("20px");
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe(""); // 未配置 → 穿透外层/兜底
  });

  it("Provider 全局 spacing 恢复生效:wrap 无内联同名变量,继承 Provider", () => {
    const { container } = render(
      <LayoutProvider config={{ spacing: { regionGap: 5 } }}>
        <LayoutViewDom />
      </LayoutProvider>,
    );
    const providerDiv = container.firstElementChild as HTMLElement;
    expect(providerDiv.style.getPropertyValue("--tl-region-gap")).toBe("5px");
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe(""); // 无内联 → 继承 Provider 的 5px
  });

  it("实例 theme 仍优先:显式键内联覆盖 Provider 同名变量", () => {
    const { container } = render(
      <LayoutProvider config={{ spacing: { regionGap: 5 } }}>
        <LayoutViewDom theme={{ spacing: { regionGap: 9 } }} />
      </LayoutProvider>,
    );
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("9px");
  });

  it("partial 多键:只内联显式配置的键,其余不内联", () => {
    const { container } = render(<LayoutViewDom theme={{ spacing: { regionGap: 5 }, sizing: { radius: 2 } }} />);
    const wrap = container.querySelector(".tl-stage-wrap") as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("5px");
    expect(wrap.style.getPropertyValue("--tl-radius")).toBe("2px");
    expect(wrap.style.getPropertyValue("--tl-header-h")).toBe(""); // 未配置 → 穿透/兜底
    expect(wrap.style.getPropertyValue("--tl-corner")).toBe("");
    expect(wrap.style.getPropertyValue("--tl-pad-region")).toBe("");
  });
});

describe("LayoutViewDom initialLayout 引导", () => {
  it("首挂载时 store 为默认 → 应用声明式初始布局", () => {
    render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />);
    const s = useLayout.getState().screen;
    expect(s.areas).toHaveLength(1);
    expect(s.areas[0].contentType).toBe("editor");
  });

  it("store 已被改过(非默认)时,挂载不冲掉用户数据", () => {
    useLayout.getState().restore({ v: 1, areas: [{ id: 1, contentType: "general", rect: [0, 0, 1, 1] }] });
    render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 0.5, 1] }, { id: 2, rect: [0.5, 0, 1, 1] }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(1); // 未被 initialLayout 覆盖
  });

  it("initialLayout 应用后种子容器同步(switchTo 不再回退默认)", () => {
    render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(1);
    expect(useWorkspaces.getState().data["layout-1"].snapshot.areas).toHaveLength(1); // 种子快照同步
  });

  it("迟到传入:首挂载无 initialLayout,prop 后到仍可引导(store 仍是默认)", () => {
    const { rerender } = render(<LayoutViewDom />);
    expect(useLayout.getState().screen.areas).toHaveLength(3); // 未引导
    rerender(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(1); // prop 到后才引导
  });

  it("活跃工作区非种子(layout-2)时不引导", () => {
    useWorkspaces.setState((s) => ({
      activeId: "layout-2",
      list: [...s.list, { id: "layout-2", name: "L2" }],
      data: { ...s.data, "layout-2": s.data["layout-1"] },
    }));
    render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1] }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(3); // 不覆盖非种子工作区
  });

  it("无效 initialLayout 不炸挂载:降级 warn,布局保持默认", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 2, 1] }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("StrictMode 双挂载只引导一次(模块级标记)", () => {
    render(
      <StrictMode>
        <LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />
      </StrictMode>,
    );
    expect(useLayout.getState().screen.areas).toHaveLength(1);
  });

  it("用户改了实例状态(几何未变)后重挂载不冲回初始布局", () => {
    // 先引导一次
    const { unmount } = render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />);
    unmount();
    // 模拟用户在自定义布局上改了内容状态
    useAreaState.setState({ map: { 1: { editor: { zoom: 9 } } } });
    const { container } = render(<LayoutViewDom initialLayout={{ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] }} />);
    expect(useLayout.getState().screen.areas).toHaveLength(1);
    expect(useAreaState.getState().map[1]?.editor?.zoom).toBe(9); // 内容未被清空
    expect(container).toBeTruthy();
  });
});
