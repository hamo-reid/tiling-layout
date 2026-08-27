import { describe, expect, it } from "vitest";
import * as G from "../src/geometry";
import { buildInitialScreen } from "../src/screen";

function oneRect(w: number, h: number) {
  const s = G.createScreen();
  const a = G.addArea(s, G.rect(0, 0, w, h));
  return { s, a };
}
const byType = (s: G.Screen, t: string) => s.areas.find((a) => a.contentType === t)!;

/** 平铺不变量：任意编辑后区域总面积恒等于舞台面积(不重叠、无缝隙的直接推论) */
function expectTiling(s: G.Screen, w = 1, h = 1) {
  const sum = s.areas.reduce((acc, a) => acc + a.rect.width * a.rect.height, 0);
  expect(sum).toBeCloseTo(w * h, 9);
}

/** 推导分界线不变量：同线线段互不重叠(允许端点相触)、无舞台贴边线段 */
function expectCleanSegs(s: G.Screen) {
  const segs = G.deriveEdges(s);
  const lines = new Map<string, [number, number][]>();
  for (const g of segs) {
    const vert = g.v1.x === g.v2.x;
    const coord = vert ? g.v1.x : g.v1.y;
    expect(coord).toBeGreaterThan(0); // 不贴舞台外框
    expect(coord).toBeLessThan(1);
    const lo = vert ? Math.min(g.v1.y, g.v2.y) : Math.min(g.v1.x, g.v2.x);
    const hi = vert ? Math.max(g.v1.y, g.v2.y) : Math.max(g.v1.x, g.v2.x);
    expect(hi).toBeGreaterThan(lo); // 零长度段不产生
    const k = `${vert ? "V" : "H"}|${coord.toFixed(9)}`;
    const ivs = lines.get(k) ?? [];
    for (const [plo, phi] of ivs) {
      const overlap = Math.min(hi, phi) - Math.max(lo, plo);
      expect(overlap, `线 ${k} 上段 [${plo},${phi}] 与 [${lo},${hi}] 重叠`).toBeLessThanOrEqual(1e-9);
    }
    ivs.push([lo, hi]);
    lines.set(k, ivs);
  }
}

/** 推导线段确定性：同一几何重复推导 → 完全一致(id 稳定可作 React key) */
function expectDeterministic(s: G.Screen) {
  const a = G.deriveEdges(s);
  const b = G.deriveEdges(s);
  expect(a.map((g) => [g.id, g.v1.x, g.v1.y, g.v2.x, g.v2.y]))
    .toEqual(b.map((g) => [g.id, g.v1.x, g.v1.y, g.v2.x, g.v2.y]));
}

describe("splitCoord / 最小尺寸", () => {
  it("垂直 0.5 → 分成两等宽(比例)", () => {
    const { a } = oneRect(0.5, 0.75);
    const c = G.splitCoord(a, G.AXIS.V, 0.5);
    expect(c).toBe(0.25); // 0.5 × 0.5
  });
  it("切到 10% 被夹逼到最小宽度", () => {
    const { a } = oneRect(0.5, 0.5);
    const c = G.splitCoord(a, G.AXIS.V, 0.1);
    expect(c).toBeCloseTo(G.MIN_AREA_W, 9);
  });
  it("区域过小则拒绝", () => {
    const { a } = oneRect(G.MIN_AREA_W, 0.5); // 宽度=最小 → 不可再垂直切
    expect(G.splitCoord(a, G.AXIS.V, 0.5)).toBeNull();
  });
});

describe("split 几何编辑", () => {
  it("垂直半分 → 两个 0.25 宽区域、共享完整分界线", () => {
    const { s, a } = oneRect(0.5, 0.5);
    const na = G.split(s, a, G.AXIS.V, 0.5);
    expect(na).toBeTruthy();
    expect(s.areas.length).toBe(2);
    const ws = s.areas.map((x) => x.rect.width);
    expect(ws).toEqual([0.25, 0.25]);
    expect(G.findSharedEdge(s, a, na!)).toBe(true);
  });
  it("水平半分 → 两个 0.25 高区域", () => {
    const { s, a } = oneRect(0.5, 0.5);
    G.split(s, a, G.AXIS.H, 0.5);
    expect(s.areas.map((x) => x.rect.height)).toEqual([0.25, 0.25]);
  });
  it("水平分割 fac>0.5 → 新区域在上方，原区收为下方", () => {
    const { s, a } = oneRect(0.5, 0.5);
    const na = G.split(s, a, G.AXIS.H, 0.75);
    expect(na).toBeTruthy();
    expect(na!.rect.ymin).toBeCloseTo(0.375, 9); // 新区域在上(0.375..0.5)
    expect(a.rect.ymax).toBeCloseTo(0.375, 9);   // 原区收为下
  });
  it("非二进制比例(1/3)分割后两块宽度之和仍≈1(浮点安全)", () => {
    const { s, a } = oneRect(1, 1);
    G.split(s, a, G.AXIS.V, 1 / 3);
    expect(s.areas.length).toBe(2);
    const ws = s.areas.map((x) => x.rect.width);
    expect(ws[0] + ws[1]).toBeCloseTo(1, 9); // 0.333… + 0.666…
  });
  it("复杂分割序列后平铺无重叠无缝隙、推导分界线无重叠无贴边", () => {
    const s = buildInitialScreen();
    G.split(s, byType(s, "outline"), G.AXIS.V, 0.5);
    G.split(s, byType(s, "properties"), G.AXIS.V, 0.4);
    G.split(s, byType(s, "editor"), G.AXIS.V, 0.3);
    // 用户场景：A 两次水平分割后再各列垂直分割
    const A = byType(s, "editor");
    const aTop = G.split(s, A, G.AXIS.H, 0.4)!;
    const aMid = G.split(s, A, G.AXIS.H, 0.6)!;
    G.split(s, aTop, G.AXIS.V, 0.3);
    G.split(s, aMid, G.AXIS.V, 0.5);
    G.split(s, A, G.AXIS.V, 0.7);
    expectTiling(s);
    expectCleanSegs(s);
    expectDeterministic(s);
  });
  it("分割出的两块推导出恰好一条公共线段", () => {
    const { s, a } = oneRect(0.5, 0.5);
    const na = G.split(s, a, G.AXIS.V, 0.5)!;
    const segs = G.deriveEdges(s);
    expect(segs).toHaveLength(1);
    expect(segs[0].v1.x).toBeCloseTo(0.25, 9);
    expect(segs[0].v1.y).toBeCloseTo(0, 9);
    expect(segs[0].v2.y).toBeCloseTo(0.5, 9);
    expect(segs[0].v1.x).toBeCloseTo(segs[0].v2.x, 9);
    expect(G.findAreaAtXY(s, 0.4, 0.1)).toBe(a);  // 原区保留右(大)半
    expect(G.findAreaAtXY(s, 0.1, 0.1)).toBe(na); // 新区域为左(小)半
  });
});

describe("deriveEdges 推导分界线", () => {
  it("初始布局 → 3 条内部分界线段，无舞台外框段", () => {
    const s = buildInitialScreen();
    const segs = G.deriveEdges(s);
    expect(segs).toHaveLength(3);
    expectCleanSegs(s);
    expectDeterministic(s);
  });
  it("T 型交会：长线被正交分割切成多段，同线线段互不重叠", () => {
    const s = buildInitialScreen();
    G.split(s, byType(s, "outline"), G.AXIS.V, 0.5);
    G.split(s, byType(s, "properties"), G.AXIS.V, 0.4);
    const hSegs = G.deriveEdges(s).filter((g) => g.v1.y === g.v2.y);
    expect(hSegs.length).toBe(3); // y=gy 横线被切成 3 段
    expectCleanSegs(s);
  });
  it("合并后接缝收敛：join 邻区共线边界合并为一条完整线段", () => {
    const s = buildInitialScreen();
    const b = byType(s, "outline"), c = byType(s, "properties");
    expect(G.joinAreas(s, b, c)).toBe(b);
    // 右列并成整块后，x=0.62 分界线只剩一条贯穿整高的线段
    const vSegs = G.deriveEdges(s).filter((g) => g.v1.x === g.v2.x);
    expect(vSegs).toHaveLength(1);
    expect(vSegs[0].v1.y).toBeCloseTo(0, 9);
    expect(vSegs[0].v2.y).toBeCloseTo(1, 9);
    expectTiling(s);
  });
});

describe("edgeFamilyAreas 连通线族", () => {
  it("整条 x=0.62 线族：贯通线两侧 3 块全部入族(含正交相接的传播)", () => {
    const s = buildInitialScreen();
    const seg = G.deriveEdges(s).find((g) => g.v1.x === g.v2.x)!;
    const fam = G.edgeFamilyAreas(s, seg);
    expect(fam).toHaveLength(3);
    const m = new Map(fam.map((f) => [f.area.contentType, f.side]));
    expect(m.get("editor")).toBe("min");
    expect(m.get("outline")).toBe("max");
    expect(m.get("properties")).toBe("max");
  });
  it("同坐标但不连通的两条线不相互传播(中间隔整跨矩形)", () => {
    const s = G.createScreen();
    G.addArea(s, G.rect(0, 0, 0.5, 0.4), "a");   // 上左 → 与下左共 x=0.5 线段
    G.addArea(s, G.rect(0.5, 0, 1, 0.4), "b");   // 上右
    G.addArea(s, G.rect(0, 0.4, 1, 0.6), "c");   // 中带：横跨 x=0.5，隔断上下两条线
    G.addArea(s, G.rect(0, 0.6, 0.5, 1), "d");   // 下左 → 另一条 x=0.5 线段
    G.addArea(s, G.rect(0.5, 0.6, 1, 1), "e");   // 下右
    expectTiling(s);
    const segs = G.deriveEdges(s);
    const atX = segs.filter((g) => g.v1.x === g.v2.x && g.v1.x === 0.5);
    expect(atX).toHaveLength(2); // 两条互不连通的 x=0.5 线段
    const [lo, hi] = atX.sort((p, q) => p.v1.y - q.v1.y);
    expect(G.edgeFamilyAreas(s, lo)).toHaveLength(2); // 只含 a/b
    expect(G.edgeFamilyAreas(s, hi!)).toHaveLength(2); // 只含 d/e
    expectCleanSegs(s);
  });
});

describe("snapCoord 吸附", () => {
  it("desired 0.25 命中 1/2 等分(0.5 跨度)", () => {
    const { s, a } = oneRect(0.5, 0.5);
    expect(G.snapCoord(s, a, 0.25, 0, G.AXIS.H, 0.5, 0)).toBe(0.25);
  });
  it("对齐吸附：优先吸附其它区域的对齐边界(胜过 12 分格)", () => {
    const s = G.createScreen();
    const a = G.addArea(s, G.rect(0, 0, 0.5, 1), "a");
    G.addArea(s, G.rect(0.5, 0, 1, 0.3), "b");
    G.addArea(s, G.rect(0.5, 0.3, 1, 1), "c");
    // 拖 a 的水平线：候选含 b|c 分界 y=0.3(与 a 角点 x∈{0,0.5} 正交对齐)
    // mCur=0.31 距 12 分格最近点 0.2917 有 0.0183，距对齐线 0.3 仅 0.01 → 对齐胜出
    expect(G.snapCoord(s, a, 0.11, 0.2, G.AXIS.H, 0.3, 0.2)).toBeCloseTo(0.3, 9);
  });
});

describe("joinAreas 合并", () => {
  it("把两块相邻区域合并成一整块", () => {
    const s = G.createScreen();
    const a = G.addArea(s, G.rect(0, 0, 0.5, 0.5), "a");
    const b = G.addArea(s, G.rect(0.5, 0, 1, 0.5), "b");
    const keep = G.joinAreas(s, a, b);
    expect(keep).toBe(a);
    expect(s.areas.length).toBe(1);
    expect(a.rect.width).toBeCloseTo(1, 9);
    expectTiling(s, 1, 0.5);
  });
  it("分割后合并回 → 恢复原状(往返稳定)", () => {
    const { s, a } = oneRect(0.5, 0.5);
    const na = G.split(s, a, G.AXIS.V, 0.5)!;
    expect(G.joinAreas(s, a, na)).toBe(a);
    expect(s.areas.length).toBe(1);
    expect(a.rect.width).toBeCloseTo(0.5, 9);
  });
  it("非对齐(中间夹第三块不可合并)→ 拒绝", () => {
    const s = buildInitialScreen();
    const a0 = s.areas[0]; // 左区
    const b2 = s.areas[2]; // 右下"属性"
    const before = s.areas.length;
    expect(G.joinAreas(s, a0, b2)).toBeNull();
    expect(s.areas.length).toBe(before);
  });
});

describe("isBoundaryAdjacent 边界相邻", () => {
  it("A 与目录只共享一顶点仍相邻(用于 swap)", () => {
    const s = buildInitialScreen();
    expect(G.isBoundaryAdjacent(s, s.areas[0], s.areas[1])).toBe(true);
    expect(G.findSharedEdge(s, s.areas[0], s.areas[1])).toBe(false); // 但非完整边
  });
});
