/**
 * geometry/edges.ts — 推导分界线段、命中、连通线族(纯函数,无 React/DOM)。
 *
 * 分界线不持久化:由相邻矩形的公共边界推导(deriveEdges),渲染/命中/拖拽全部
 * 消费推导结果;derived 段的 id 确定性排序,可直接作 React key 与命中标识。
 */
import { AXIS, EPS, corners, cornerKey } from "./types";
import type { Area, EdgeHit, FamilyMember, Screen, Seg } from "./types";
import { runtime } from "../runtimeConfig";

/** 点到线段的最短距离 @internal */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * 推导全部分界线段：枚举每对相邻矩形的公共边界重叠段。
 * 确定性排序(先竖后横、按坐标) → id 稳定，可直接用作 React key 与命中标识。
 * 舞台外框(无邻居一侧)不产生线段，天然杜绝"外框被画成可拖拽分界线"。
 *  @param s 目标屏幕
 *  @returns 全部内部分界线段(id 从 1 起，同一几何恒定) */
export function deriveEdges(s: Screen): Seg[] {
  const verticals = new Map<number, { min: Area[]; max: Area[] }>();
  const horizontals = new Map<number, { min: Area[]; max: Area[] }>();
  for (const a of s.areas) {
    const r = a.rect;
    const reg = (m: Map<number, { min: Area[]; max: Area[] }>, coord: number, side: "min" | "max") => {
      let g = m.get(coord);
      if (!g) { g = { min: [], max: [] }; m.set(coord, g); }
      g[side].push(a);
    };
    reg(verticals, r.xmin, "max"); reg(verticals, r.xmax, "min");
    reg(horizontals, r.ymin, "max"); reg(horizontals, r.ymax, "min");
  }

  const segs: Seg[] = [];
  const push = (vertical: boolean, coord: number, lo: number, hi: number) => {
    segs.push(vertical
      ? { id: 0, v1: { x: coord, y: lo }, v2: { x: coord, y: hi } }
      : { id: 0, v1: { x: lo, y: coord }, v2: { x: hi, y: coord } });
  };
  const pairs = (
    m: Map<number, { min: Area[]; max: Area[] }>,
    loOf: (a: Area) => number, hiOf: (a: Area) => number,
    vertical: boolean,
  ) => {
    for (const [coord, g] of [...m.entries()].sort((p, q) => p[0] - q[0])) {
      for (const a of g.min) for (const b of g.max) {
        const lo = Math.max(loOf(a), loOf(b)), hi = Math.min(hiOf(a), hiOf(b));
        if (hi - lo > EPS) push(vertical, coord, lo, hi);
      }
    }
  };
  pairs(verticals, (a) => a.rect.ymin, (a) => a.rect.ymax, true);
  pairs(horizontals, (a) => a.rect.xmin, (a) => a.rect.xmax, false);

  segs.sort((p, q) => {
    const pv = p.v1.x === p.v2.x, qv = q.v1.x === q.v2.x;
    if (pv !== qv) return pv ? -1 : 1;
    const k = (g: Seg) => pv
      ? [g.v1.x, Math.min(g.v1.y, g.v2.y), Math.max(g.v1.y, g.v2.y)]
      : [g.v1.y, Math.min(g.v1.x, g.v2.x), Math.max(g.v1.x, g.v2.x)];
    const kp = k(p), kq = k(q);
    return (kp[0] - kq[0]) || (kp[1] - kq[1]) || (kp[2] - kq[2]);
  });
  segs.forEach((g, i) => (g.id = i + 1));
  return segs;
}

/** 分界线命中检测：找距指针最近且距离在容差内的推导线段
 *  @param s 目标屏幕
 *  @param x 指针 x(归一化比例)
 *  @param y 指针 y(归一化比例)
 *  @param tol 命中容差(缺省取 runtime().hitTolerance，出厂值 EDGE_TOLERANCE)
 *  @returns 命中的线段及其方向；无命中返回 null
 * @category 几何
 */
export function findEdgeAtPos(s: Screen, x: number, y: number, tol?: number): EdgeHit | null {
  const t = tol ?? runtime().hitTolerance;
  let best: Seg | null = null, bestDist = Infinity;
  for (const seg of deriveEdges(s)) {
    const d = distToSeg(x, y, seg.v1.x, seg.v1.y, seg.v2.x, seg.v2.y);
    if (d <= t && d <= bestDist) { bestDist = d; best = seg; }
  }
  return best ? { seg: best, dir: best.v1.x === best.v2.x ? AXIS.V : AXIS.H } : null;
}

/** 两区域是否共享一条完整分界线(公共角点 ≥ 2，即公共边界段的两端同时是双方角点)。
 *  join 的前置条件；仅部分边界相邻(共享角点 < 2)不构成可合并。
 *  角点比较走 cornerKey(toFixed(6))，反序列化引入的 ulp 级误差不阻断合并。
 *  @param a1 区域一
 *  @param a2 区域二
 *  @returns 共享完整分界线时 true */
export function findSharedEdge(_s: Screen, a1: Area, a2: Area): boolean {
  if (a1 === a2) return false;
  const set1 = new Set(corners(a1.rect).map(cornerKey));
  let n = 0;
  for (const k of corners(a2.rect)) if (set1.has(cornerKey(k))) n++;
  return n >= 2;
}

/** 两区域是否"沿边界相邻"(共享 >0 长度边界段) —— 用于 swap；join 用 findSharedEdge。
 *  @param a 区域一
 *  @param b 区域二
 *  @returns 沿边界相邻时 true */
export function isBoundaryAdjacent(_s: Screen, a: Area, b: Area): boolean {
  const A = a.rect, B = b.rect;
  const vov = Math.min(A.ymax, B.ymax) - Math.max(A.ymin, B.ymin);
  const hov = Math.min(A.xmax, B.xmax) - Math.max(A.xmin, B.xmin);
  if (Math.abs(A.xmax - B.xmin) < EPS && vov > 0.01) return true;
  if (Math.abs(A.xmin - B.xmax) < EPS && vov > 0.01) return true;
  if (Math.abs(A.ymax - B.ymin) < EPS && hov > 0.01) return true;
  if (Math.abs(A.ymin - B.ymax) < EPS && hov > 0.01) return true;
  return false;
}

/** 同向连通线族：与 seg 同向、同坐标、区间相接(端点相触亦算)的全部线段。
 *  一条被 T 型点切分的长线 hover 任一段即整条命中(高亮/拖拽同源语义)。
 *  @param s 目标屏幕
 *  @param seg 起始线段
 *  @returns 该连通线族包含的全部线段 */
export function connectedSegs(s: Screen, seg: Seg): Set<Seg> {
  const vertical = seg.v1.x === seg.v2.x;
  const coord = vertical ? seg.v1.x : seg.v1.y;
  const loOf = (g: Seg) => vertical ? Math.min(g.v1.y, g.v2.y) : Math.min(g.v1.x, g.v2.x);
  const hiOf = (g: Seg) => vertical ? Math.max(g.v1.y, g.v2.y) : Math.max(g.v1.x, g.v2.x);
  const all = deriveEdges(s).filter((g) =>
    (vertical ? g.v1.x === g.v2.x : g.v1.y === g.v2.y)
    && (vertical ? g.v1.x : g.v1.y) === coord);

  const family = new Set<Seg>([seg]);
  let lo = loOf(seg), hi = hiOf(seg), changed = true;
  while (changed) {
    changed = false;
    for (const g of all) {
      if (family.has(g)) continue;
      if (loOf(g) <= hi && hiOf(g) >= lo) {      // 区间相接(闭区间触端点)
        family.add(g);
        lo = Math.min(lo, loOf(g)); hi = Math.max(hi, hiOf(g));
        changed = true;
      }
    }
  }
  return family;
}

/** 拖动分界线时须整体平移的矩形族：与该线段同向、坐标相同、区间相接的全部区域。
 *  @param s 目标屏幕
 *  @param seg 命中的线段
 *  @returns 族成员(area + 其位于线的 min/max 哪一侧)；resize 按 side 平移对应边
 * @category 几何
 */
export function edgeFamilyAreas(s: Screen, seg: Seg): FamilyMember[] {
  const vertical = seg.v1.x === seg.v2.x;
  const coord = vertical ? seg.v1.x : seg.v1.y;
  // 线族的空间区间(沿线的延伸范围)，随传播增长
  let lo = vertical ? Math.min(seg.v1.y, seg.v2.y) : Math.min(seg.v1.x, seg.v2.x);
  let hi = vertical ? Math.max(seg.v1.y, seg.v2.y) : Math.max(seg.v1.x, seg.v2.x);

  const members = new Map<Area, FamilyMember>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of s.areas) {
      if (members.has(a)) continue;
      const r = a.rect;
      const near = vertical ? r.xmin : r.ymin;   // 触线边:较小侧
      const far = vertical ? r.xmax : r.ymax;    // 触线边:较大侧
      const alo = vertical ? r.ymin : r.xmin;    // 沿线区间
      const ahi = vertical ? r.ymax : r.xmax;
      let side: "min" | "max" | null = null;
      if (far === coord) side = "min";
      else if (near === coord) side = "max";
      if (side === null) continue;
      if (alo > hi || ahi < lo) continue;        // 区间不相接 → 属于另一条线
      members.set(a, { area: a, side });
      lo = Math.min(lo, alo); hi = Math.max(hi, ahi);
      changed = true;
    }
  }
  return [...members.values()];
}
