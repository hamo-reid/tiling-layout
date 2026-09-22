/**
 * geometry/commands.ts — 命令式排布原语(纯函数,无 React/DOM)。
 *
 * 手势模块(`store/corner|dock|resize`)与程序化调用方共用这一份实现：
 *   - `splitAt`     : 确定性分割(源区保 min 侧)，替掉 `split()` 的"永远保较大部分"翻面语义；
 *   - `planClose` / `applyClose` : 关闭区域并入紧邻者 —— 库过去只在 `dockUp` 里
 *     私有一份"找单邻居吞并"的写法，此处补上多邻居(T 型交会)的分摊扩张；
 *   - `segBetween`  : a/b 面对面所在的那条分界线；
 *   - `lineBounds` / `planLineTo` / `applyLineTo` / `planRatio` : 整条连通线族的
 *     平移与夹逼 —— `resizeMove` 与 `setRatio` 是它的两个调用方，不再各算一遍。
 *
 * ⚠ 坐标不变式(见 geometry.ts 头注)：公共边界坐标必须**单点计算后写给每个受影响
 * 矩形**，不能逐成员各自重算 —— 否则邻接判定与 deriveEdges 的 `===` 精确比较失效。
 * 本文件所有写边动作都遵守：先算出一个 `value`，再原样写给族内全部成员。
 */
import { AXIS, EPS, addArea, rect, withRect } from "./types";
import type { Area, Axis, FamilyMember, Rect, Screen, Seg } from "./types";
import { deriveEdges, edgeFamilyAreas } from "./edges";
import { splitCoord } from "./layout";
import { runtime } from "../runtimeConfig";

/** 关闭时并入的那一侧 */
export type CloseSide = "left" | "right" | "top" | "bottom";
/** 四边停靠槽(center 是交换、none 是无目标，都不在这里) */
export type DockSide = "left" | "right" | "top" | "bottom";
/** 可被替换的矩形边(改边一律走 withRect 以保持派生字段) */
export type RectEdge = "xmin" | "ymin" | "xmax" | "ymax";

/** 邻居分段首尾相接的比对容差(与快照满铺校验同档，吸收分割链的累计误差) */
const TILE_TOUCH_EPS = 1e-6;

/** 关闭计划：删掉 `removeId`，并把 `expansions` 里每条边推到新坐标 */
export interface ClosePlan {
  readonly removeId: number;
  readonly side: CloseSide;
  readonly expansions: readonly { readonly id: number; readonly edge: RectEdge; readonly value: number }[];
  /** 邻居多于一个(需向多个方向扩张)：结果可能不再是纯 guillotine 铺满 */
  readonly spanned: boolean;
}

/** 单个成员在本次平移中的可行边界 —— 夹逼的**原子单位**。
 *  `lineBounds` 的 `lo`/`hi` 是它对线族的归约，`ResizeCtx.adj`(兼容字段)是它的逐成员展开：
 *  两者同源，不会各算一套。 */
export interface MemberLimit {
  readonly min?: number;
  readonly max?: number;
}

/** 线族夹逼区间与整体跨度 */
export interface LineBounds {
  readonly axis: Axis;
  /** 分界线可移动到的最小坐标(全部成员 `limits.min` 的最大值) */
  readonly lo: number;
  /** 分界线可移动到的最大坐标(全部成员 `limits.max` 的最小值) */
  readonly hi: number;
  /** 线族沿垂直方向的整体跨度 [min 侧最外边, max 侧最外边]，供按比例定位 */
  readonly span: readonly [number, number];
  /** 族成员(含各自位于线的哪一侧) */
  readonly family: readonly FamilyMember[];
  /** 逐成员的可行边界，与 `family` 同序 */
  readonly limits: readonly MemberLimit[];
}

// 单边替换(withRect 重算派生字段)
const setEdge = (r: Rect, edge: RectEdge, value: number): Rect =>
  edge === "xmin" ? withRect(r, { xmin: value })
    : edge === "xmax" ? withRect(r, { xmax: value })
      : edge === "ymin" ? withRect(r, { ymin: value })
        : withRect(r, { ymax: value });

/**
 * 沿 `dir` 一分为二：**源区保 min 侧**(dir='V' 保左半、'H' 保下半)且占比 `ratio`，
 * 新块拿 max 侧并继承源区的 contentType。
 *
 * 与 `split()` 的差别是**确定性**：`split()` 让源区永远保留较大部分，于是新块落在
 * 哪一侧会随 fac 跨过 0.5 而翻面 —— 调用方(尤其程序化/脚本)需要确定的侧别。
 * 最小尺寸夹逼复用 `splitCoord()`(minAreaW/H)。
 *
 *  @param s 目标屏幕(就地修改)
 *  @param area 被分割的区域
 *  @param dir 分割方向
 *  @param ratio 源区保留的比例(0..1，越界由 splitCoord 收拢)
 *  @returns `{ kept, created }`；区域不足以分割时返回 null
 * @category 几何
 */
export function splitAt(
  s: Screen, area: Area, dir: Axis, ratio: number,
): { kept: Area; created: Area } | null {
  const coord = splitCoord(area, dir, ratio);
  if (coord === null) return null;
  const r = area.rect;
  const created = dir === AXIS.H
    ? addArea(s, rect(r.xmin, coord, r.xmax, r.ymax), area.contentType)
    : addArea(s, rect(coord, r.ymin, r.xmax, r.ymax), area.contentType);
  area.rect = dir === AXIS.H ? withRect(r, { ymax: coord }) : withRect(r, { xmax: coord });
  return { kept: area, created };
}

/** 某一侧的合格邻居；不合格返回 null */
function sideHits(
  areas: readonly Area[], target: Area, side: CloseSide, exclude: ReadonlySet<number>,
): { area: Area; lo: number; hi: number; edge: RectEdge; value: number }[] | null {
  const r = target.rect;
  const vertical = side === "left" || side === "right";
  const edge: RectEdge = side === "left" ? "xmax" : side === "right" ? "xmin" : side === "top" ? "ymin" : "ymax";
  const value = side === "left" ? r.xmax : side === "right" ? r.xmin : side === "top" ? r.ymin : r.ymax;
  const touching = side === "left" ? r.xmin : side === "right" ? r.xmax : side === "top" ? r.ymax : r.ymin;
  const spanLo = vertical ? r.ymin : r.xmin;
  const spanHi = vertical ? r.ymax : r.xmax;

  const hits: { area: Area; lo: number; hi: number; edge: RectEdge; value: number }[] = [];
  for (const area of areas) {
    if (area === target || exclude.has(area.id)) continue;
    const a = area.rect;
    const near = side === "left" ? a.xmax : side === "right" ? a.xmin : side === "top" ? a.ymin : a.ymax;
    if (near !== touching) continue;                       // 触线坐标位级一致(见头注不变式)
    const lo = vertical ? a.ymin : a.xmin;
    const hi = vertical ? a.ymax : a.xmax;
    // 扩张后的并集必须是矩形：邻居跨距必须落在 R 的跨距内
    if (lo < spanLo - EPS || hi > spanHi + EPS) continue;
    if (hi - lo <= EPS) continue;
    hits.push({ area, lo, hi, edge, value });
  }
  if (hits.length === 0) return null;
  // 重叠区间必须首尾相接、正好铺满 R 的该条边
  hits.sort((p, q) => p.lo - q.lo);
  let cursor = spanLo;
  for (const hit of hits) {
    if (Math.abs(hit.lo - cursor) > TILE_TOUCH_EPS) return null;
    cursor = hit.hi;
  }
  if (Math.abs(cursor - spanHi) > TILE_TOUCH_EPS) return null;
  return hits;
}

/**
 * 规划关闭：把 `id` 的区域并入紧邻的区域。
 *
 * 按 [左, 右, 上, 下] 找「与 R 共享整条边」的邻居集合 N：
 *   ① 每条候选垂直于该边必须落在 R 的跨距内(否则并集不是矩形)；
 *   ② N 的重叠区间必须**正好铺满** R 的该条边(首尾相接、无空隙、不重叠)；
 *   ③ 先取 |N| === 1 的(纯 guillotine，等价于 findSharedEdge 的情形)，
 *      都没有才用 |N| > 1 的整组扩张 —— 后者产出的是"T 型交会处的分摊闭合"。
 * 四边都不成立 → null，调用方**不得改动任何东西**。
 *
 *  @param areas 目标屏幕的区域(只读，本函数不修改)
 *  @param id 要关闭的区域 id
 *  @param opts.exclude 不可作为吞并方的区域 id(dock 用：停靠槽与目标区不能吞源区)
 *  @returns 落地方案；无解返回 null
 * @category 几何
 */
export function planClose(
  areas: readonly Area[], id: number, opts: { exclude?: readonly number[] } = {},
): ClosePlan | null {
  const target = areas.find((a) => a.id === id);
  if (target === undefined) return null;
  const exclude = new Set(opts.exclude ?? []);
  const sides: CloseSide[] = ["left", "right", "top", "bottom"];
  const found: { side: CloseSide; hits: NonNullable<ReturnType<typeof sideHits>> }[] = [];
  for (const side of sides) {
    const hits = sideHits(areas, target, side, exclude);
    if (hits !== null) found.push({ side, hits });
  }
  const chosen = found.find((f) => f.hits.length === 1) ?? found[0];
  if (chosen === undefined) return null;
  return {
    removeId: id,
    side: chosen.side,
    spanned: chosen.hits.length > 1,
    expansions: chosen.hits.map((hit) => ({ id: hit.area.id, edge: hit.edge, value: hit.value })),
  };
}

/**
 * 落地一个关闭计划(就地修改)。调用方应先跑 `checkTiling` 或自行确认合法性。
 *  @param s 目标屏幕
 *  @param plan `planClose` 的产物
 * @category 几何
 */
export function applyClose(s: Screen, plan: ClosePlan): void {
  const byId = new Map(s.areas.map((a) => [a.id, a]));
  for (const { id, edge, value } of plan.expansions) {
    const area = byId.get(id);
    if (area !== undefined) area.rect = setEdge(area.rect, edge, value);
  }
  s.areas = s.areas.filter((a) => a.id !== plan.removeId);
}

/**
 * 停靠槽矩形：把 `R` 按 `side` 切出占比 `factor` 的那一块(不修改任何东西)。
 *
 * 预览层(拖拽时的槽提示)、并集重排(源区与目标共享整边时把并集切成两块)、
 * 停靠热区命中三处本来各写一遍四分支，现在共用这一份。
 *  @param R 被切的目标矩形(或源区与目标的并集)
 *  @param side 停靠侧
 *  @param factor 槽占该维的比例(0..1，越界由调用方或此处收拢)
 *  @returns 该侧的槽矩形
 * @category 几何
 */
export function dockSlotRect(R: Rect, side: DockSide, factor: number): Rect {
  const f = Math.max(0, Math.min(1, factor));
  if (side === "left") return rect(R.xmin, R.ymin, R.xmin + R.width * f, R.ymax);
  if (side === "right") return rect(R.xmax - R.width * f, R.ymin, R.xmax, R.ymax);
  if (side === "bottom") return rect(R.xmin, R.ymin, R.xmax, R.ymin + R.height * f);
  return rect(R.xmin, R.ymax - R.height * f, R.xmax, R.ymax);
}

/** 停靠槽的「另一块」：槽与它恰好并成 `R` */
export function dockRestRect(R: Rect, side: DockSide, factor: number): Rect {
  const slot = dockSlotRect(R, side, factor);
  return side === "left" ? withRect(R, { xmin: slot.xmax })
    : side === "right" ? withRect(R, { xmax: slot.xmin })
      : side === "bottom" ? withRect(R, { ymin: slot.ymax })
        : withRect(R, { ymax: slot.ymin });
}

/**
 * 把 a 与 b 面对面所在的那条分界线。
 *
 * 判据比 `findSharedEdge` 宽：T 型交会处两块并不共享"整条"边(长的那侧被切过)，
 * 但确实在同一条分界线的两侧。所以是三者同时成立 ——
 *   ① 两者都在某条分界线的连通线族里(同一坐标、同向、区间相接)；
 *   ② 分属线的两侧；
 *   ③ 垂直于该线方向上真的相接(有正重叠)—— 排除"同一条线的上下两段"这种伪命中。
 *  @param s 目标屏幕
 *  @param a 区域一
 *  @param b 区域二
 *  @returns 分界线；不面对面返回 null
 * @category 几何
 */
export function segBetween(s: Screen, a: Area, b: Area): Seg | null {
  for (const seg of deriveEdges(s)) {
    let sideA: "min" | "max" | undefined;
    let sideB: "min" | "max" | undefined;
    for (const m of edgeFamilyAreas(s, seg)) {
      if (m.area === a) sideA = m.side;
      else if (m.area === b) sideB = m.side;
    }
    if (sideA === undefined || sideB === undefined || sideA === sideB) continue;
    const vertical = seg.v1.x === seg.v2.x;
    const [aLo, aHi] = vertical ? [a.rect.ymin, a.rect.ymax] : [a.rect.xmin, a.rect.xmax];
    const [bLo, bHi] = vertical ? [b.rect.ymin, b.rect.ymax] : [b.rect.xmin, b.rect.xmax];
    if (Math.min(aHi, bHi) - Math.max(aLo, bLo) > EPS) return seg;
  }
  return null;
}

/** 单个成员的可行边界：min 侧以内边 + minArea 卡住线，max 侧对称 */
function memberLimit(m: FamilyMember, vertical: boolean, room: number): MemberLimit {
  const r = m.area.rect;
  if (m.side === "min") return vertical ? { min: r.xmin + room } : { min: r.ymin + room };
  return vertical ? { max: r.xmax - room } : { max: r.ymax - room };
}

/**
 * 线族的夹逼区间、整体跨度与成员表。
 *
 * `lo`/`hi` 与 `beginResize` 原先各自算的 `adj` **同一口径**：min 侧每个成员都要留住
 * minArea(取最靠里的那条内边 + minArea)，max 侧对称 —— 这里把该式提成 `memberLimit`，
 * `limits` 是逐成员展开、`lo`/`hi` 是它的归约，两者同源。
 * `span` 是该线族沿垂直方向的整体跨度，供按比例定位(`planRatio`)。
 *
 * ⚠ **必须在动手之前取**：线一旦离开原坐标，`edgeFamilyAreas` 就再也匹配不到
 * 族成员(它按触线坐标精确比对)。拖拽手势在 `beginResize` 取一次、之后每帧用同一份；
 * 一次性命令(`applyLineTo` / `setRatio`)从干净状态调用，故可在内部现取。
 *  @param s 目标屏幕
 *  @param seg 分界线
 *  @returns 区间与成员；线族不完整(某一侧为空)返回 null
 * @category 几何
 */
export function lineBounds(s: Screen, seg: Seg): LineBounds | null {
  const vertical = seg.v1.x === seg.v2.x;
  const axis: Axis = vertical ? AXIS.V : AXIS.H;
  const room = vertical ? runtime().minAreaW : runtime().minAreaH;
  const family = edgeFamilyAreas(s, seg);
  const minSide = family.filter((m) => m.side === "min");
  const maxSide = family.filter((m) => m.side === "max");
  if (minSide.length === 0 || maxSide.length === 0) return null;

  const inner = (m: { area: Area }) => (vertical ? m.area.rect.xmin : m.area.rect.ymin);
  const outer = (m: { area: Area }) => (vertical ? m.area.rect.xmax : m.area.rect.ymax);
  const spanLo = Math.min(...minSide.map(inner));
  const spanHi = Math.max(...maxSide.map(outer));
  const limits = family.map((m) => memberLimit(m, vertical, room));
  let lo = -Infinity, hi = Infinity;
  for (const l of limits) {
    if (l.min !== undefined) lo = Math.max(lo, l.min);
    if (l.max !== undefined) hi = Math.min(hi, l.max);
  }
  return { axis, lo, hi, span: [spanLo, spanHi], family, limits };
}

/** 把坐标夹进可行区间 */
export function clampLine(b: LineBounds, coord: number): number {
  return Math.max(b.lo, Math.min(b.hi, coord));
}

/**
 * 按已解析好的线族把整条线平移到 `coord`(就地修改)。**同一个坐标值写给每个成员**。
 * 拖拽手势走这条(用 `beginResize` 时捕获的 bounds)，一次性命令走 `applyLineTo`。
 *  @param seg 分界线(取起点坐标作 `from`)
 *  @param bounds 事先取好的线族
 *  @param coord 目标坐标(内部再夹逼一次，幂等)
 *  @returns 实际落点与族规模；bounds 不可行返回 null
 * @category 几何
 */
export function writeLine(
  seg: Seg, bounds: LineBounds, coord: number,
): { from: number; to: number; axis: Axis; members: number } | null {
  if (bounds.lo > bounds.hi) return null;
  const from = bounds.axis === AXIS.V ? seg.v1.x : seg.v1.y;
  const to = clampLine(bounds, coord);
  for (const m of bounds.family) {
    const edge: RectEdge = m.side === "min"
      ? (bounds.axis === AXIS.V ? "xmax" : "ymax")
      : (bounds.axis === AXIS.V ? "xmin" : "ymin");
    m.area.rect = setEdge(m.area.rect, edge, to);
  }
  return { from, to, axis: bounds.axis, members: bounds.family.length };
}

/**
 * 求把线移到 `coord` 后的实际落点(夹逼，不改动任何东西)。
 *  @param s 目标屏幕
 *  @param seg 分界线(仍须处于其原坐标)
 *  @param coord 期望坐标(越界自动收拢到可行区间)
 *  @returns `{ to, from }`；线族不完整或可行区间为空返回 null
 * @category 几何
 */
export function planLineTo(s: Screen, seg: Seg, coord: number): { to: number; from: number } | null {
  const b = lineBounds(s, seg);
  if (b === null || b.lo > b.hi) return null;
  const from = b.axis === AXIS.V ? seg.v1.x : seg.v1.y;
  return { from, to: clampLine(b, coord) };
}

/** 按比例定位：a 侧占线族整体跨度的 `ratio` */
export function planRatio(s: Screen, seg: Seg, ratio: number): { to: number; from: number } | null {
  const b = lineBounds(s, seg);
  if (b === null) return null;
  const [spanLo, spanHi] = b.span;
  return planLineTo(s, seg, spanLo + ratio * (spanHi - spanLo));
}

/**
 * 一次性把整条连通线族平移到 `coord`(就地修改)。**要求 seg 仍在原坐标** ——
 * 拖拽循环请改用 `lineBounds` + `writeLine`(见 `lineBounds` 的⚠)。
 *  @param s 目标屏幕
 *  @param seg 分界线
 *  @param coord 目标坐标
 *  @returns `{ from, to, axis, members }`；不成立返回 null
 * @category 几何
 */
export function applyLineTo(
  s: Screen, seg: Seg, coord: number,
): { from: number; to: number; axis: Axis; members: number } | null {
  const bounds = lineBounds(s, seg);
  return bounds === null ? null : writeLine(seg, bounds, coord);
}
