import { beforeEach, describe, expect, it } from "vitest";
import * as G from "../src/geometry";
import { useLayout } from "../src/layoutStore";
import { buildInitialScreen } from "../src/screen";
import { getAreaState, setAreaState, useAreaState } from "../src/areaStore";
import { collectSnapshot } from "../src/layoutData";

/** 当前屏幕三类区域 id(buildInitialScreen 从 _id=1 起分配 → 1/2/3，勿硬编码数值) */
function ids() {
  const areas = useLayout.getState().screen.areas;
  return {
    editor: areas.find((a) => a.contentType === "editor")!.id,
    outline: areas.find((a) => a.contentType === "outline")!.id,
    properties: areas.find((a) => a.contentType === "properties")!.id,
  };
}

/** 重置整个状态机：屏幕几何 + 实例状态 + 交互态 + 历史(各用例自备) */
function resetLayout() {
  useAreaState.setState({ map: {} });
  useLayout.setState({
    screen: buildInitialScreen(),
    mode: "idle",
    status: "",
    cornerStart: { x: 0, y: 0 },
    lastPt: { x: 0, y: 0 },
    srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false, ctrl: false,
    resize: null, dock: null, maximizedId: null,
    past: [], future: [],
  });
}

describe("layoutStore 区域最大化", () => {
  beforeEach(resetLayout);

  it("toggleMaximize 最大化指定区域", () => {
    useLayout.getState().toggleMaximize(ids().editor);
    expect(useLayout.getState().maximizedId).toBe(ids().editor);
  });

  it("再次 toggle 同一区域 → 退出最大化", () => {
    const s = useLayout.getState();
    s.toggleMaximize(ids().outline);
    s.toggleMaximize(ids().outline);
    expect(useLayout.getState().maximizedId).toBeNull();
  });

  it("toggle 另一区域 → 切换最大化目标", () => {
    const s = useLayout.getState();
    s.toggleMaximize(ids().editor);
    s.toggleMaximize(ids().outline);
    expect(useLayout.getState().maximizedId).toBe(ids().outline);
  });

  it("exitMaximize 清空", () => {
    useLayout.getState().toggleMaximize(ids().editor);
    useLayout.getState().exitMaximize();
    expect(useLayout.getState().maximizedId).toBeNull();
  });

  it("restore(切换/载入布局)后最大化被清空", () => {
    useLayout.getState().toggleMaximize(ids().editor);
    useLayout.getState().restore({ v: 1, areas: [], areaStates: {}, shared: { x: 0, rot: 0 } });
    expect(useLayout.getState().maximizedId).toBeNull();
  });

  it("toggleMaximize 使交互态回到 idle", () => {
    useLayout.getState().toggleMaximize(ids().editor);
    const s = useLayout.getState();
    expect(s.mode).toBe("idle");
    expect(s.resize).toBeNull();
    expect(s.dock).toBeNull();
  });
});

describe("layoutStore undo/redo 历史", () => {
  beforeEach(resetLayout);

  it("commitHistory 压栈并清空 future", () => {
    const st = useLayout.getState();
    st.commitHistory();
    st.commitHistory();
    expect(useLayout.getState().past.length).toBe(2);
  });
  it("空栈 undo/redo 无操作", () => {
    const st = useLayout.getState();
    st.undo();
    st.redo();
    expect(useLayout.getState().past.length).toBe(0);
    expect(useLayout.getState().future.length).toBe(0);
  });
  it("分割操作后可 undo 回原状再 redo", () => {
    const st = useLayout.getState();
    expect(st.screen.areas.length).toBe(3);
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5); // 锁定 editor、V 向 0.2
    st.cornerUp();           // 分割 → 4 区
    expect(useLayout.getState().screen.areas.length).toBe(4);

    useLayout.getState().undo();
    expect(useLayout.getState().screen.areas.length).toBe(3);

    useLayout.getState().redo();
    expect(useLayout.getState().screen.areas.length).toBe(4);
  });
});

describe("layoutStore corner 分割", () => {
  beforeEach(resetLayout);

  it("拖离锚点不足距离不锁定(防误判)", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.305, 0.5);
    expect(useLayout.getState().srcId).toBeNull();
    expect(useLayout.getState().mode).toBe("corner");
  });
  it("向左侧拖 → V 向分割线，落下后分裂出新区域", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);
    const mid = useLayout.getState();
    expect(mid.splitDir).toBe(G.AXIS.V);
    expect(mid.splitLine).toBe(0.2);

    mid.cornerUp();
    const fin = useLayout.getState();
    expect(fin.screen.areas.length).toBe(4);
    expect(fin.mode).toBe("idle");
    expect(fin.status).toContain("已分割");
  });
  it("分割出的新区域继承来源实例状态(clone)", () => {
    const vp = ids().editor;
    useAreaState.setState({ map: { [vp]: { editor: { view: { rot: 42 } } } } });
    const st = useLayout.getState();
    const beforeIds = new Set(st.screen.areas.map((a) => a.id));
    st.beginCorner(vp, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);
    st.cornerUp();
    const fin = useLayout.getState();
    const nid = fin.screen.areas.find((a) => !beforeIds.has(a.id))!.id;
    expect(getAreaState(nid, "editor")).toEqual({ view: { rot: 42 } });
  });
  it("无拖拽直接落下 → 已取消", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerUp();
    const fin = useLayout.getState();
    expect(fin.status).toBe("已取消");
    expect(fin.screen.areas.length).toBe(3);
  });
});

describe("layoutStore corner 合并/交换", () => {
  beforeEach(resetLayout);

  it("拖到相邻区域 → 合并(源吞目标)", () => {
    const ol = ids().outline, pr = ids().properties; // 初始仅 outline↔properties 共享整条边
    const st = useLayout.getState();
    st.beginCorner(ol, { x: 0.7, y: 0.8 }, false);
    st.cornerMove(0.75, 0.8); // 锁定 outline
    st.cornerMove(0.75, 0.2); // 悬停 properties → 共享整条边可合并
    expect(useLayout.getState().hoverTId).toBe(pr);

    useLayout.getState().cornerUp();
    const fin = useLayout.getState();
    expect(fin.screen.areas.length).toBe(2); // outline 吞 properties
    expect(fin.status).toContain("已合并");
  });
  it("Ctrl 拖到相邻区域 → 内容交换(含实例状态)", () => {
    const ol = ids().outline, pr = ids().properties;
    useAreaState.setState({ map: { [ol]: { outline: { v: 1 } }, [pr]: { properties: { v: 3 } } } });
    const st = useLayout.getState();
    st.beginCorner(ol, { x: 0.7, y: 0.8 }, true);
    st.cornerMove(0.75, 0.8);
    st.cornerMove(0.75, 0.2); // ctrl: 边界相邻即可
    st.cornerUp();
    const fin = useLayout.getState();
    expect(fin.screen.areas.find((a) => a.id === ol)!.contentType).toBe("properties");
    expect(fin.screen.areas.find((a) => a.id === pr)!.contentType).toBe("outline");
    expect(getAreaState(ol, "properties")).toEqual({ v: 3 }); // 状态随内容互换
    expect(getAreaState(pr, "outline")).toEqual({ v: 1 });
  });
  it("悬停可合并目标时分割方向让位(合并优先)", () => {
    const ol = ids().outline, pr = ids().properties;
    const st = useLayout.getState();
    st.beginCorner(ol, { x: 0.7, y: 0.8 }, false);
    st.cornerMove(0.75, 0.8); // 锁定 outline，已进入 split 路径
    expect(useLayout.getState().splitDir).toBe(G.AXIS.V);
    st.cornerMove(0.75, 0.2); // 悬停 properties → 合并优先，splitDir 清空
    const fin = useLayout.getState();
    expect(fin.hoverTId).toBe(pr);
    expect(fin.splitDir).toBeNull();
  });
});

describe("layoutStore toggleSplitDir", () => {
  beforeEach(resetLayout);

  it("拖拽中切换分割方向", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5); // splitDir=V
    expect(useLayout.getState().splitDir).toBe(G.AXIS.V);
    useLayout.getState().toggleSplitDir();
    expect(useLayout.getState().splitDir).toBe(G.AXIS.H);
  });
  it("换向后按最近指针位置重算分割线(cornerUp 不再用错轴坐标落刀)", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);          // V 向，splitLine=0.2(x 值)
    expect(useLayout.getState().splitLine).toBe(0.2);
    useLayout.getState().toggleSplitDir(); // → H 向：splitLine 必须重算为 y 值
    const mid = useLayout.getState();
    expect(mid.splitDir).toBe(G.AXIS.H);
    expect(mid.splitLine).toBeCloseTo(0.5, 9); // lastPt.y=0.5，而非沿用 x=0.2
    mid.cornerUp();
    const fin = useLayout.getState();
    expect(fin.screen.areas).toHaveLength(4);
    // 落刀在 editor 内部 y≈0.5：存在上下两半(ymin=0.5 / ymax=0.5 的 editor 半块)
    const halves = fin.screen.areas.filter((a) => a.contentType === "editor");
    expect(halves).toHaveLength(2);
    const ys = new Set(halves.flatMap((a) => [a.rect.ymin, a.rect.ymax]));
    expect([...ys].some((y) => Math.abs(y - 0.5) < 1e-9)).toBe(true);
  });
  it("非 corner 模式(idle)下 splitDir 残留也不允许切换", () => {
    // 复现审计缺陷：restore/中断路径留下脏 splitDir 时，Tab 不应误触
    useLayout.setState({ splitDir: G.AXIS.V, splitLine: 0.2 });
    useLayout.getState().toggleSplitDir();
    expect(useLayout.getState().splitDir).toBe(G.AXIS.V); // 未变
  });
  it("悬停目标时不允许切换方向", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.4, 0.5);
    st.cornerMove(0.8, 0.4); // hoverTId 非 null
    const before = useLayout.getState().splitDir;
    useLayout.getState().toggleSplitDir();
    expect(useLayout.getState().splitDir).toBe(before); // 不变
  });
});

describe("layoutStore dock 停靠", () => {
  beforeEach(resetLayout);

  it("中心热区 → 交换内容", () => {
    const ol = ids().outline, vp = ids().editor;
    const st = useLayout.getState();
    st.beginDock(ol, { x: 0.7, y: 0.8 });
    st.dockMove(0.3, 0.5); // viewport 中心
    expect(useLayout.getState().dock?.target).toBe("center");

    useLayout.getState().dockUp();
    const fin = useLayout.getState();
    expect(fin.screen.areas.find((a) => a.id === ol)!.contentType).toBe("editor");
    expect(fin.screen.areas.find((a) => a.id === vp)!.contentType).toBe("outline");
  });
  it("左侧热区 → 目标分裂出槽承载内容，源区闭合", () => {
    const ol = ids().outline;
    const st = useLayout.getState();
    st.beginDock(ol, { x: 0.7, y: 0.8 });
    st.dockMove(0.05, 0.5); // viewport 左边缘
    expect(useLayout.getState().dock?.target).toBe("left");

    useLayout.getState().dockUp();
    const fin = useLayout.getState();
    expect(fin.status).toContain("已停靠");
    // 槽承载源(outline)内容；源区被 properties 邻居吞并闭合
    expect(fin.screen.areas.filter((a) => a.contentType === "outline")).toHaveLength(1);
    expect(fin.screen.areas.length).toBe(3);
  });
  it("拖回源区自身 → 无目标，落下取消", () => {
    const st = useLayout.getState();
    st.beginDock(ids().outline, { x: 0.7, y: 0.8 });
    st.dockMove(0.7, 0.8);
    expect(useLayout.getState().dock?.target).toBe("none");

    useLayout.getState().dockUp();
    expect(useLayout.getState().status).toBe("已取消");
  });
});

describe("layoutStore resize 夹逼约束(全族成员)", () => {
  beforeEach(resetLayout);

  /** 命中 x=0.62 竖线的下段(properties 侧, y∈[0,gy]) */
  function lowerVertSeg() {
    return G.deriveEdges(useLayout.getState().screen)
      .find((x) => x.v1.x === x.v2.x && Math.min(x.v1.y, x.v2.y) === 0)!;
  }

  it("向左拖不压破横跨整线的对侧区域(editor 全高，审计复现)", () => {
    // 旧行为：editor 的沿线区间 [0,1] 与命中段 [0,gy] 不完全相等 → 被排除出
    // 约束 → lo=-Infinity，可把 editor 拖到 0 宽。新行为：全族成员都参与夹逼。
    useLayout.getState().beginResize(lowerVertSeg(), { x: 0.62, y: 0.2 });
    useLayout.getState().resizeMove(0.01, 0.2);
    const rects = useLayout.getState().screen.areas.map((a) => a.rect);
    // 线被夹逼在 editor.xmin + MIN_AREA_W = 0.06，editor 不得低于最小宽度
    expect(rects[0].xmax).toBeCloseTo(G.MIN_AREA_W, 9);
    expect(rects[1].xmin).toBeCloseTo(G.MIN_AREA_W, 9);
    expect(rects[2].xmin).toBeCloseTo(G.MIN_AREA_W, 9);
    for (const r of rects) {
      expect(r.width).toBeGreaterThanOrEqual(G.MIN_AREA_W - 1e-9);
      expect(r.height).toBeGreaterThanOrEqual(G.MIN_AREA_H - 1e-9);
    }
  });

  it("嵌套线族不产生几何反转(max 侧成员的远边参与夹逼)", () => {
    // 构造：右列 C 再竖分 → 线族 max 侧出现 far edge=x0.81 的成员 C1；
    // 旧行为命中下段时 hi=0.94，newV 可越过 0.81 使 C1 反转(xmin>xmax)
    const s = useLayout.getState().screen;
    G.split(s, s.areas.find((a) => a.contentType === "outline")!, G.AXIS.V, 0.5); // 0.62→1 分割
    useLayout.setState({ screen: { ...s } });
    const c1 = s.areas.find((a) => a.contentType === "outline" && a.rect.xmax < 1)!; // 左半(触 0.62 线)
    expect(c1.rect.xmin).toBeCloseTo(0.62, 9);
    expect(c1.rect.xmax).toBeCloseTo(0.81, 9);
    const lowerSeg = G.deriveEdges(s)
      .find((x) => x.v1.x === x.v2.x && Math.min(x.v1.y, x.v2.y) === 0)!;

    useLayout.getState().beginResize(lowerSeg, { x: 0.62, y: 0.2 });
    useLayout.getState().resizeMove(0.9, 0.2);
    // C1 是 max 侧成员：内边随线移到夹逼位，远边(0.81)不动 → 无反转
    expect(c1.rect.xmin).toBeCloseTo(0.75, 9); // 0.81 - MIN_AREA_W，而非 0.94
    expect(c1.rect.xmax).toBeCloseTo(0.81, 9);
    expect(c1.rect.xmax).toBeGreaterThan(c1.rect.xmin);
  });

  it("cancel 回滚已改写的几何，且不入历史栈", () => {
    const before = useLayout.getState().screen.areas.map((a) => ({ ...a.rect }));
    useLayout.getState().beginResize(lowerVertSeg(), { x: 0.62, y: 0.2 });
    useLayout.getState().resizeMove(0.7, 0.2); // 几何已被原地改写
    useLayout.getState().cancel();
    const fin = useLayout.getState();
    expect(fin.mode).toBe("idle");
    expect(fin.status).toBe("已取消");
    expect(fin.past).toHaveLength(0);          // 取消不污染 undo 栈
    fin.screen.areas.forEach((a, i) => {
      expect(a.rect).toEqual(before[i]);       // 「已取消」名副其实：几何还原
    });
  });

  it("实际位移的 endResize 入历史栈(undo 回到拖拽前)；纯点击不入栈", () => {
    useLayout.getState().beginResize(lowerVertSeg(), { x: 0.62, y: 0.2 });
    useLayout.getState().resizeMove(0.7, 0.2);
    useLayout.getState().endResize();
    expect(useLayout.getState().past).toHaveLength(1);
    const after = useLayout.getState().screen.areas.map((a) => a.rect.xmin);
    useLayout.getState().undo();
    const restored = useLayout.getState().screen.areas.map((a) => a.rect.xmin);
    expect(restored).not.toEqual(after);
    expect(restored[1]).toBeCloseTo(0.62, 9);  // 回到拖拽前

    resetLayout();
    useLayout.getState().beginResize(lowerVertSeg(), { x: 0.62, y: 0.2 });
    useLayout.getState().endResize();          // 未发生位移
    expect(useLayout.getState().past).toHaveLength(0);
  });
});

describe("layoutStore 取消手势不污染历史栈", () => {
  beforeEach(resetLayout);

  it("cornerUp 纯取消(无拖拽)不产生 undo 条目", () => {
    useLayout.getState().beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    useLayout.getState().cornerUp();
    expect(useLayout.getState().status).toBe("已取消");
    expect(useLayout.getState().past).toHaveLength(0);
  });
  it("dockUp 纯取消(拖回自身)不产生 undo 条目", () => {
    const st = useLayout.getState();
    st.beginDock(ids().outline, { x: 0.7, y: 0.8 });
    st.dockUp();
    expect(useLayout.getState().status).toBe("已取消");
    expect(useLayout.getState().past).toHaveLength(0);
  });
  it("分割/合并实际生效才入栈(undo 一步还原)", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);
    st.cornerUp();
    expect(useLayout.getState().past).toHaveLength(1); // 分割生效
    st.beginCorner(ids().outline, { x: 0.7, y: 0.8 }, false);
    st.cornerMove(0.75, 0.8);
    st.cornerMove(0.75, 0.2);
    st.cornerUp(); // 合并生效
    expect(useLayout.getState().past).toHaveLength(2);
  });
});

describe("layoutStore resize 调整大小", () => {
  beforeEach(resetLayout);

  it("拖动竖分界线平移整个连通线族，且被邻居最小尺寸夹逼", () => {
    const st = useLayout.getState();
    const seg = G.deriveEdges(st.screen).find((x) => x.v1.x === x.v2.x)!; // x=0.62 竖线段

    st.beginResize(seg, { x: 0.62, y: 0.5 });
    expect(useLayout.getState().mode).toBe("resizing");

    useLayout.getState().resizeMove(0.7, 0.5);
    const rects = useLayout.getState().screen.areas.map((a) => a.rect);
    expect(rects[0].xmax).toBeCloseTo(0.7, 9); // viewport(min 侧) 内边随动
    expect(rects[1].xmin).toBeCloseTo(0.7, 9); // outline(max 侧) 内边随动
    expect(rects[2].xmin).toBeCloseTo(0.7, 9); // properties(同线族另一段) 随动

    // 拖过远 → 被邻居最小宽度夹逼到 0.94
    useLayout.getState().resizeMove(0.99, 0.5);
    const rects2 = useLayout.getState().screen.areas.map((a) => a.rect);
    expect(rects2[0].xmax).toBeCloseTo(0.94, 9);
    expect(rects2[1].xmin).toBeCloseTo(0.94, 9);
    expect(rects2[2].xmin).toBeCloseTo(0.94, 9);

    useLayout.getState().endResize();
    const fin = useLayout.getState();
    expect(fin.mode).toBe("idle");
    expect(fin.resize).toBeNull();
    expect(fin.status).toBe("就绪");
  });
  it("未处于 resize 时 resizeMove 无操作", () => {
    const st = useLayout.getState();
    st.resizeMove(0.8, 0.5); // resize=null → 直接返回
    expect(useLayout.getState().screen.areas.length).toBe(3);
  });
});

describe("layoutStore cancel / restore", () => {
  beforeEach(resetLayout);

  it("cancel 清空所有交互态", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);
    useLayout.getState().cancel();
    const fin = useLayout.getState();
    expect(fin.mode).toBe("idle");
    expect(fin.status).toBe("已取消");
    expect(fin.splitDir).toBeNull();
    expect(fin.screen.areas.length).toBe(3); // 几何未动
  });
  it("restore 应用快照重建屏幕", () => {
    const st = useLayout.getState();
    const orig = collectSnapshot(st.screen); // 分割前深拷贝(screen 会被原地修改)
    // 先做一个分割让 restore 产生可见变化
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5);
    st.cornerUp();
    expect(useLayout.getState().screen.areas.length).toBe(4);

    useLayout.getState().restore(orig);
    expect(useLayout.getState().screen.areas.length).toBe(3); // 回到原 3 区
  });
  it("restore 清空手势残留字段(脏上下文不跨布局串场)", () => {
    const st = useLayout.getState();
    st.beginCorner(ids().editor, { x: 0.3, y: 0.5 }, false);
    st.cornerMove(0.2, 0.5); // 留下 srcId/splitDir/splitLine/lastPt 等中间态
    useLayout.getState().restore({ v: 1, areas: [], areaStates: {}, shared: { x: 0, rot: 0 } });
    const fin = useLayout.getState();
    expect(fin.srcId).toBeNull();
    expect(fin.hoverTId).toBeNull();
    expect(fin.splitDir).toBeNull();
    expect(fin.splitLine).toBe(0);
    expect(fin.snapped).toBe(false);
    expect(fin.resize).toBeNull();
    expect(fin.dock).toBeNull();
  });
});

describe("layoutStore setAreaContent", () => {
  beforeEach(resetLayout);

  it("切换 contentType：进历史栈，Area 对象不可变替换", () => {
    const vp = ids().editor;
    const before = useLayout.getState().screen.areas.find((a) => a.id === vp)!;
    useLayout.getState().setAreaContent(vp, "shader");
    const fin = useLayout.getState();
    const after = fin.screen.areas.find((a) => a.id === vp)!;
    expect(after.contentType).toBe("shader");
    expect(after).not.toBe(before);              // 新对象(细粒度 selector 可感知)
    expect(after.rect).toBe(before.rect);         // 几何矩形引用不变
    expect(useLayout.getState().past).toHaveLength(1); // 进了历史栈
    expect(fin.status).toContain("已切换为");
  });
  it("undo 回到切换前", () => {
    const vp = ids().editor;
    useLayout.getState().setAreaContent(vp, "shader");
    useLayout.getState().undo();
    expect(useLayout.getState().screen.areas.find((a) => a.id === vp)!.contentType).toBe("editor");
  });
  it("同类型/不存在区域 no-op，不污染历史栈", () => {
    const vp = ids().editor;
    useLayout.getState().setAreaContent(vp, "editor");
    useLayout.getState().setAreaContent(99999, "shader");
    expect(useLayout.getState().past).toHaveLength(0);
    expect(useLayout.getState().screen.areas).toHaveLength(3);
  });
  it("切换后各类型实例状态分槽保留，切回即恢复", () => {
    const vp = ids().editor;
    setAreaState(vp, "editor", { view: { rot: 42 } });
    useLayout.getState().setAreaContent(vp, "shader");
    setAreaState(vp, "shader", { nodeCount: 5 });
    expect(getAreaState(vp, "editor")).toEqual({ view: { rot: 42 } }); // 旧类型槽位还在
    useLayout.getState().setAreaContent(vp, "editor");
    expect(getAreaState(vp, "editor")).toEqual({ view: { rot: 42 } }); // 切回即恢复
    expect(getAreaState(vp, "shader")).toEqual({ nodeCount: 5 });
  });
});
