import { beforeEach, describe, expect, it } from "vitest";
import * as G from "../src/geometry";
import { useLayout } from "../src/layoutStore";
import { getAreaState, setAreaState, useAreaState } from "../src/areaStore";
import { configureRuntime } from "../src/runtimeConfig";
import type { DockTarget } from "../src/layoutStore";

function screenOf(...specs: [number, number, number, number, string][]): G.Screen {
  const s = G.createScreen();
  for (const [xmin, ymin, xmax, ymax, type] of specs) G.addArea(s, G.rect(xmin, ymin, xmax, ymax), type);
  return s;
}
const rectOf = (s: G.Screen, id: number): number[] => {
  const r = s.areas.find((a) => a.id === id)!.rect;
  return [r.xmin, r.ymin, r.xmax, r.ymax];
};
const rects = () => useLayout.getState().screen.areas.map((a) => [a.id, rectOf(useLayout.getState().screen, a.id)]);
const snap = () => JSON.stringify(rects());

function reset(s: G.Screen) {
  useAreaState.setState({ map: {} });
  useLayout.setState({
    screen: s, mode: "idle", status: "",
    cornerStart: { x: 0, y: 0 }, lastPt: { x: 0, y: 0 },
    srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false, ctrl: false,
    resize: null, dock: null, maximizedId: null,
    past: [], future: [],
  });
}
/** 直接摆好停靠中间态再 dockUp(不经过指针，聚焦落位本身) */
function beginDockUp(srcId: number, targetId: number, target: DockTarget, factorDock = 0.5) {
  useLayout.setState({
    mode: "docking",
    dock: { srcId, start: { x: 0, y: 0 }, targetId, target, factorDock, canClose: true },
  });
  useLayout.getState().dockUp();
}
const historyDepth = () => useLayout.getState().past.length;

beforeEach(() => configureRuntime());

describe("四边停靠 · 单邻居共享整边(并集重排)", () => {
  it("源区与目标正好铺满并集：两区原位改尺寸，内容各自跟随", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    setAreaState(1, "a", { keep: 1 });
    beginDockUp(1, 2, "left", 0.3);
    expect(useLayout.getState().status).toContain("已停靠");
    expect(useLayout.getState().screen.areas).toHaveLength(2);
    const a = rectOf(useLayout.getState().screen, 1);
    const b = rectOf(useLayout.getState().screen, 2);
    expect(a[0]).toBeCloseTo(0, 9);
    expect(a[2]).toBeCloseTo(0.3, 9);          // 源区缩到左侧 30%
    expect(b[0]).toBeCloseTo(0.3, 9);          // 目标填剩下的 70%
    expect(b[2]).toBeCloseTo(1, 9);
    expect(a[2]).toBe(b[0]);                   // 公共边坐标位级一致
    // 不增删区域、不迁移状态：两侧内容各自留在原 id 上
    expect(getAreaState(1, "a")).toEqual({ keep: 1 });
    expect(historyDepth()).toBe(1);
  });
});

describe("四边停靠 · 多邻居分摊闭合(T 型交会)", () => {
  it("源区位置被两个邻居正好铺满 → 现在能闭合(旧实现只会取消)", () => {
    // src 左列；中间列被上下切成两块(各自都与 src 只共享半条边)；目标在最右列
    reset(screenOf(
      [0, 0, 0.25, 1, "src"],
      [0.25, 0.5, 0.5, 1, "top"],
      [0.25, 0, 0.5, 0.5, "bot"],
      [0.5, 0, 1, 1, "tgt"],
    ));
    setAreaState(1, "src", { carried: true });
    beginDockUp(1, 4, "right", 0.5);

    const st = useLayout.getState();
    expect(st.status).toContain("已停靠");
    expect(st.status).toContain("分摊闭合");
    // src 已消失，两块中间列各自向左扩张到 0，目标被切成保留块 + 承载 src 的槽
    expect(st.screen.areas).toHaveLength(4);
    expect(st.screen.areas.some((a) => a.id === 1)).toBe(false);
    expect(rectOf(st.screen, 2)).toEqual([0, 0.5, 0.5, 1]);
    expect(rectOf(st.screen, 3)).toEqual([0, 0, 0.5, 0.5]);
    expect(rectOf(st.screen, 4)).toEqual([0.5, 0, 0.75, 1]);
    const slot = st.screen.areas.find((a) => a.id !== 2 && a.id !== 3 && a.id !== 4)!;
    expect(rectOf(st.screen, slot.id)).toEqual([0.75, 0, 1, 1]);
    expect(slot.contentType).toBe("src");            // 拖区内容进槽
    expect(getAreaState(slot.id, "src")).toEqual({ carried: true });  // 实例状态随之搬迁
    expect(getAreaState(1, "src")).toEqual({});      // 源槽位丢弃
    expect(historyDepth()).toBe(1);
  });
});

describe("四边停靠 · 失败路径必须零改动", () => {
  it("无邻居可吞并源区 → 取消，且目标区**没有**被留在分裂后的样子", () => {
    reset(screenOf(
      [0, 0, 0.5, 1, "a"],      // 左全高
      [0.5, 0.5, 1, 1, "b"],    // 右上(目标)
      [0.5, 0, 1, 0.5, "c"],    // 右下：a 与 b/c 都只部分相邻
    ));
    const before = snap();
    beginDockUp(1, 2, "right", 0.5);
    expect(useLayout.getState().status).toContain("无法闭合");
    expect(snap()).toBe(before);            // 试算用的克隆被丢弃，原屏分毫未动
    expect(historyDepth()).toBe(0);
  });

  it("目标过小无法分裂 → 取消且零改动", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 0.52, 0.3, "b"]));
    const before = snap();
    beginDockUp(1, 2, "right", 0.5);
    expect(useLayout.getState().status).toContain("过小");
    expect(snap()).toBe(before);
    expect(historyDepth()).toBe(0);
  });

  it("target=none / 缺 dock 会话 → 已取消", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    const before = snap();
    useLayout.setState({ dock: null });
    useLayout.getState().dockUp();
    expect(useLayout.getState().status).toBe("已取消");
    beginDockUp(1, 2, "none");
    expect(useLayout.getState().status).toBe("已取消");
    expect(snap()).toBe(before);
    expect(historyDepth()).toBe(0);
  });
});

describe("中心停靠 = 交换内容", () => {
  it("内容与实例状态互换，几何不动", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    setAreaState(1, "a", { from: "a" });
    setAreaState(2, "b", { from: "b" });
    beginDockUp(1, 2, "center");
    const st = useLayout.getState();
    expect(st.status).toContain("已交换");
    expect(st.screen.areas).toHaveLength(2);
    expect(rectOf(st.screen, 1)).toEqual([0, 0, 0.5, 1]);
    expect(st.screen.areas.find((a) => a.id === 1)!.contentType).toBe("b");
    expect(st.screen.areas.find((a) => a.id === 2)!.contentType).toBe("a");
    // 实例状态与内容一起换槽
    expect(getAreaState(1, "b")).toEqual({ from: "b" });
    expect(getAreaState(2, "a")).toEqual({ from: "a" });
    expect(historyDepth()).toBe(1);
  });
});

describe("canClose(拖拽中的可行性门控)", () => {
  it("T 型交会处现在被判为可行(planClose 统一判定)，落位的拖动不再提前变 none", () => {
    reset(screenOf(
      [0, 0, 0.25, 1, "src"],
      [0.25, 0.5, 0.5, 1, "top"],
      [0.25, 0, 0.5, 0.5, "bot"],
      [0.5, 0, 1, 1, "tgt"],
    ));
    const st = useLayout.getState();
    st.beginDock(1, { x: 0.1, y: 0.5 });
    // 指针落在最右列右半边 → target=right；源区能被 top/bot 分摊闭合
    useLayout.getState().dockMove(0.9, 0.5);
    expect(useLayout.getState().dock!.target).toBe("right");
    expect(useLayout.getState().dock!.canClose).toBe(true);
  });

  it("源区无处可去的拖动仍判为 none", () => {
    reset(screenOf(
      [0, 0, 0.5, 1, "a"],
      [0.5, 0.5, 1, 1, "b"],
      [0.5, 0, 1, 0.5, "c"],
    ));
    const st = useLayout.getState();
    st.beginDock(1, { x: 0.25, y: 0.5 });
    useLayout.getState().dockMove(0.95, 0.75);   // 落在 b 的靠右边缘(target=right)
    expect(useLayout.getState().dock!.target).toBe("none");
    expect(useLayout.getState().dock!.canClose).toBe(false);
  });
});
