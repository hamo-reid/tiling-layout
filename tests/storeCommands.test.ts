import { beforeEach, describe, expect, it } from "vitest";
import * as G from "../src/geometry";
import { useLayout } from "../src/layoutStore";
import { getAreaState, setAreaState, useAreaState } from "../src/areaStore";
import { configureRuntime } from "../src/runtimeConfig";

/** 由 [xmin,ymin,xmax,ymax] + contentType 列表造一屏 */
function screenOf(...specs: [number, number, number, number, string][]): G.Screen {
  const s = G.createScreen();
  for (const [xmin, ymin, xmax, ymax, type] of specs) G.addArea(s, G.rect(xmin, ymin, xmax, ymax), type);
  return s;
}
const rectOf = (s: G.Screen, id: number): number[] => {
  const r = s.areas.find((a) => a.id === id)!.rect;
  return [r.xmin, r.ymin, r.xmax, r.ymax];
};
const areasOf = (id: number) => useLayout.getState().screen.areas.find((a) => a.id === id)!;

/** 重置状态机到给定屏幕 */
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
const historyDepth = () => useLayout.getState().past.length;

beforeEach(() => configureRuntime());   // 每用例回到出厂行为参数

describe("splitArea", () => {
  beforeEach(() => reset(screenOf([0, 0, 1, 1, "editor"])));

  it("切成两块、新块继承内容与实例状态、入栈恰好一次", () => {
    const id = areasOf(1).id;
    setAreaState(id, "editor", { query: "abc" });
    const res = useLayout.getState().splitArea(id, G.AXIS.V, 0.5)!;
    expect(res.kept).toBe(id);
    expect(rectOf(useLayout.getState().screen, id)).toEqual([0, 0, 0.5, 1]);
    expect(rectOf(useLayout.getState().screen, res.created)).toEqual([0.5, 0, 1, 1]);
    expect(areasOf(res.created).contentType).toBe("editor");
    expect(getAreaState(res.created, "editor")).toEqual({ query: "abc" });   // 实例状态已克隆
    expect(historyDepth()).toBe(1);
  });

  it("区域不存在 / 太小 → null 且不入栈、几何不动", () => {
    const st = useLayout.getState();
    expect(st.splitArea(999, G.AXIS.V)).toBeNull();
    expect(historyDepth()).toBe(0);
    // 太小的区域
    reset(screenOf([0, 0, 0.05, 1, "editor"]));
    expect(useLayout.getState().splitArea(1, G.AXIS.V)).toBeNull();
    expect(historyDepth()).toBe(0);
    expect(useLayout.getState().screen.areas).toHaveLength(1);
  });

  it("提交后清空手势残留(命令换掉了 areas 数组，旧引用已失效)", () => {
    const st = useLayout.getState();
    st.beginCorner(1, { x: 0, y: 0 }, false);
    useLayout.getState().splitArea(1, G.AXIS.V);
    const after = useLayout.getState();
    expect(after.mode).toBe("idle");
    expect(after.srcId).toBeNull();
    expect(after.splitDir).toBeNull();
  });
});

describe("closeArea", () => {
  it("并入紧邻者、丢弃被删区域的实例状态、入栈一次", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    setAreaState(1, "a", { keep: 1 });
    setAreaState(2, "b", { gone: 1 });
    const res = useLayout.getState().closeArea(1)!;
    expect(res.closed).toBe(1);
    expect(res.absorbedBy).toEqual([2]);
    expect(res.spanned).toBe(false);
    expect(useLayout.getState().screen.areas).toHaveLength(1);
    expect(rectOf(useLayout.getState().screen, 2)).toEqual([0, 0, 1, 1]);
    expect(getAreaState(1, "a")).toEqual({});        // 被删区域的槽位已丢弃
    expect(getAreaState(2, "b")).toEqual({ gone: 1 }); // 吞并方的状态保持
    expect(historyDepth()).toBe(1);
  });

  it("只剩一块 → null；无解(邻居没铺满) → null 且零改动", () => {
    reset(screenOf([0, 0, 1, 1, "only"]));
    expect(useLayout.getState().closeArea(1)).toBeNull();

    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 0.5, "b"]));
    const before = JSON.stringify(useLayout.getState().screen.areas.map((a) => rectOf(useLayout.getState().screen, a.id)));
    expect(useLayout.getState().closeArea(1)).toBeNull();
    expect(JSON.stringify(useLayout.getState().screen.areas.map((a) => rectOf(useLayout.getState().screen, a.id)))).toBe(before);
    expect(historyDepth()).toBe(0);
  });

  it("多邻居分摊闭合的返回体带 spanned，状态栏写明由谁分摊", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 0.5, "b"], [0.5, 0.5, 1, 1, "c"]));
    const res = useLayout.getState().closeArea(1)!;
    expect(res.spanned).toBe(true);
    expect([...res.absorbedBy].sort()).toEqual([2, 3]);
    expect(useLayout.getState().status).toContain("分摊");
    expect(rectOf(useLayout.getState().screen, 2)).toEqual([0, 0, 1, 0.5]);
    expect(rectOf(useLayout.getState().screen, 3)).toEqual([0, 0.5, 1, 1]);
    expect(historyDepth()).toBe(1);
  });

  it("opts.side 是「只接受这一侧」的强制口", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    expect(useLayout.getState().closeArea(1, { side: "left" })).toBeNull();   // 左侧无邻居
    expect(useLayout.getState().closeArea(1, { side: "right" })).not.toBeNull();
  });

  it("opts.exclude 生效(dock 用它排除槽与目标区)", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 0.5, "b"], [0.5, 0.5, 1, 1, "c"]));
    expect(useLayout.getState().closeArea(1, { exclude: [2] })).toBeNull();
  });
});

describe("mergeAreas", () => {
  it("保留 keep 的内容，丢弃 remove 的内容与实例状态", () => {
    reset(screenOf([0, 0, 0.5, 1, "keep"], [0.5, 0, 1, 1, "drop"]));
    setAreaState(2, "drop", { x: 1 });
    const res = useLayout.getState().mergeAreas(1, 2)!;
    expect(res).toEqual({ keep: 1, dropped: 2, droppedContent: "drop" });
    expect(useLayout.getState().screen.areas).toHaveLength(1);
    expect(areasOf(1).contentType).toBe("keep");
    expect(rectOf(useLayout.getState().screen, 1)).toEqual([0, 0, 1, 1]);
    expect(getAreaState(2, "drop")).toEqual({});
    expect(historyDepth()).toBe(1);
  });

  it("不共享整条分界线 / 同 id → null 且零改动", () => {
    reset(screenOf([0, 0, 0.5, 0.5, "a"], [0.5, 0, 1, 0.5, "b"], [0, 0.5, 0.5, 1, "c"], [0.5, 0.5, 1, 1, "d"]));
    expect(useLayout.getState().mergeAreas(1, 4)).toBeNull();   // 对角
    expect(useLayout.getState().mergeAreas(1, 1)).toBeNull();
    expect(useLayout.getState().screen.areas).toHaveLength(4);
    expect(historyDepth()).toBe(0);
  });
});

describe("swapAreas", () => {
  it("内容与实例状态一起换槽，几何不动", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    setAreaState(1, "a", { from: "a" });
    setAreaState(2, "b", { from: "b" });
    const res = useLayout.getState().swapAreas(1, 2)!;
    expect(res).toEqual({ a: 1, b: 2 });
    expect(areasOf(1).contentType).toBe("b");
    expect(areasOf(2).contentType).toBe("a");
    expect(rectOf(useLayout.getState().screen, 1)).toEqual([0, 0, 0.5, 1]);
    expect(getAreaState(1, "b")).toEqual({ from: "b" });
    expect(getAreaState(2, "a")).toEqual({ from: "a" });
    expect(historyDepth()).toBe(1);
  });

  it("区域不存在 / 同 id → null 且不入栈", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    expect(useLayout.getState().swapAreas(1, 999)).toBeNull();
    expect(useLayout.getState().swapAreas(1, 1)).toBeNull();
    expect(historyDepth()).toBe(0);
  });
});

describe("setRatio", () => {
  it("移动分界线并整族平移，入栈一次", () => {
    reset(screenOf([0, 0, 0.5, 0.5, "a"], [0, 0.5, 0.5, 1, "b"], [0.5, 0, 1, 1, "c"]));
    const s = useLayout.getState().screen;
    const seg = G.segBetween(s, s.areas[0], s.areas[2])!;
    const res = useLayout.getState().setRatio(seg, 0.3)!;
    expect(res.members).toBe(3);
    expect(res.to).toBeCloseTo(0.3, 9);
    expect(rectOf(useLayout.getState().screen, 1)).toEqual([0, 0, 0.3, 0.5]);
    expect(rectOf(useLayout.getState().screen, 2)).toEqual([0, 0.5, 0.3, 1]);
    expect(rectOf(useLayout.getState().screen, 3)).toEqual([0.3, 0, 1, 1]);
    expect(historyDepth()).toBe(1);
  });

  it("已在目标位置 → null，不入栈(不产生空撤销项)", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    const s = useLayout.getState().screen;
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    expect(useLayout.getState().setRatio(seg, 0.5)).toBeNull();
    expect(historyDepth()).toBe(0);
  });

  it("两侧不面对面(用户传错 seg/比例不成立) → null", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    const stray: G.Seg = { id: 0, v1: { x: 0.9, y: 0 }, v2: { x: 0.9, y: 1 } };
    expect(useLayout.getState().setRatio(stray, 0.3)).toBeNull();
    expect(historyDepth()).toBe(0);
  });
});

describe("ResizeCtx 兼容字段(0.4.0 读取方)", () => {
  it("moved / adj 仍在，且与 bounds 同源(同一份数据的展开视图，不会漂)", () => {
    reset(screenOf([0, 0, 0.5, 0.5, "a"], [0, 0.5, 0.5, 1, "b"], [0.5, 0, 1, 1, "c"]));
    const s = useLayout.getState().screen;
    const seg = G.segBetween(s, s.areas[0], s.areas[2])!;
    useLayout.getState().beginResize(seg, { x: 0.5, y: 0.5 });
    const r = useLayout.getState().resize!;

    expect(r.bounds).not.toBeNull();
    // moved === bounds.family（同序、同侧）
    expect(r.moved.map((m) => [m.area.id, m.side])).toEqual(r.bounds!.family.map((m) => [m.area.id, m.side]));
    // adj === bounds.limits
    expect(r.adj).toEqual(r.bounds!.limits);
    // 老代码的归约写法仍然得到同一对边界
    const lo = Math.max(...r.adj.map((c) => c.min ?? -Infinity));
    const hi = Math.min(...r.adj.map((c) => c.max ?? Infinity));
    expect(lo).toBeCloseTo(r.bounds!.lo, 9);
    expect(hi).toBeCloseTo(r.bounds!.hi, 9);

    // 拖拽仍按 bounds 走，且兼容字段描述的族确实都动了
    useLayout.getState().resizeMove(0.3, 0.5);
    for (const { area, side } of r.moved) {
      const rect = useLayout.getState().screen.areas.find((a) => a.id === area.id)!.rect;
      if (side === "min") expect(rect.xmax).toBeCloseTo(0.3, 9);
      else expect(rect.xmin).toBeCloseTo(0.3, 9);
    }
  });

  it("H 方向起手：dir/orig/origPt 取 y 轴，拖动同样按 bounds 平移", () => {
    reset(screenOf([0, 0, 1, 0.4, "a"], [0, 0.4, 1, 1, "b"]));
    const s = useLayout.getState().screen;
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    useLayout.getState().beginResize(seg, { x: 0.5, y: 0.4 });
    const r = useLayout.getState().resize!;
    expect(r.dir).toBe(G.AXIS.H);
    expect(r.orig).toBeCloseTo(0.4, 9);
    expect(r.origPt).toBeCloseTo(0.4, 9);        // 取指针的 y
    expect(r.bounds!.axis).toBe(G.AXIS.H);

    useLayout.getState().resizeMove(0.5, 0.8);   // 指针下移 0.4
    expect(rectOf(useLayout.getState().screen, 1)).toEqual([0, 0, 1, 0.8]);
    expect(rectOf(useLayout.getState().screen, 2)).toEqual([0, 0.8, 1, 1]);
    useLayout.getState().endResize();
    expect(historyDepth()).toBe(1);
  });

  it("起手给一条不存在的分界线(族为空)：bounds 为 null、兼容字段空表、拖动是 no-op", () => {
    reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"]));
    const stray: G.Seg = { id: 0, v1: { x: 0.9, y: 0 }, v2: { x: 0.9, y: 1 } };
    useLayout.getState().beginResize(stray, { x: 0.9, y: 0.5 });
    const r = useLayout.getState().resize!;
    expect(r.bounds).toBeNull();
    expect(r.moved).toEqual([]);
    expect(r.adj).toEqual([]);
    expect(useLayout.getState().mode).toBe("resizing");

    useLayout.getState().resizeMove(0.2, 0.5);      // 无 bounds → 直接返回
    expect(rectOf(useLayout.getState().screen, 1)).toEqual([0, 0, 0.5, 1]);
    useLayout.getState().endResize();                // dragged 仍为 false → 不入栈
    expect(historyDepth()).toBe(0);
  });
});

describe("setMaximized", () => {
  beforeEach(() => reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"])));

  it("幂等：设同一目标两次只生效一次，且**不进历史**(视图态)", () => {
    const st = useLayout.getState();
    st.setMaximized(1);
    expect(useLayout.getState().maximizedId).toBe(1);
    useLayout.getState().setMaximized(1);
    expect(useLayout.getState().maximizedId).toBe(1);
    expect(historyDepth()).toBe(0);
    useLayout.getState().setMaximized(null);
    expect(useLayout.getState().maximizedId).toBeNull();
    expect(historyDepth()).toBe(0);
  });

  it("不存在的区域 → no-op", () => {
    useLayout.getState().setMaximized(999);
    expect(useLayout.getState().maximizedId).toBeNull();
  });

  it("toggleMaximize 仍是切换语义(委托给 setMaximized)", () => {
    const st = useLayout.getState();
    st.toggleMaximize(1);
    expect(useLayout.getState().maximizedId).toBe(1);
    useLayout.getState().toggleMaximize(1);
    expect(useLayout.getState().maximizedId).toBeNull();
    useLayout.getState().toggleMaximize(1);
    useLayout.getState().toggleMaximize(2);
    expect(useLayout.getState().maximizedId).toBe(2);
    expect(historyDepth()).toBe(0);
  });
});

describe("setAreaContent(历史策略统一后)", () => {
  beforeEach(() => reset(screenOf([0, 0, 0.5, 1, "a"], [0.5, 0, 1, 1, "b"])));

  it("内容变了入栈一次；类型未变 / 区域不存在 → 不入栈", () => {
    const st = useLayout.getState();
    st.setAreaContent(1, "b");
    expect(areasOf(1).contentType).toBe("b");
    expect(historyDepth()).toBe(1);
    useLayout.getState().setAreaContent(1, "b");     // 类型未变
    expect(historyDepth()).toBe(1);
    useLayout.getState().setAreaContent(999, "x");
    expect(historyDepth()).toBe(1);
  });

  it("undo 回到切换前(入栈的是'编辑前那一屏')", () => {
    useLayout.getState().setAreaContent(1, "b");
    useLayout.getState().undo();
    expect(areasOf(1).contentType).toBe("a");
    expect(historyDepth()).toBe(0);
  });
});
