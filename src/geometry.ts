/**
 * geometry.ts — 纯几何逻辑层（无 DOM / React 依赖，可单测）。
 *
 * **矩形平铺模型**：布局即一组轴对齐、互不重叠、铺满舞台的矩形（Area.rect）。
 * 分界线不再持久存储 —— 由相邻矩形的公共边界推导（deriveEdges），渲染/命中/拖拽
 * 全部消费推导结果；网格一致性（共享边、T 型分段、悬空点清理）因此天然成立，
 * 不再需要清理算法。操作语义与旧顶点/边模型逐一对齐：
 *   - splitCoord / split               : 依据比例在区域内切出分界线
 *   - joinAreas                        : 相邻区域合并（并集须为矩形）
 *   - deriveEdges / connectedSegs      : 推导分界线段、同向连通线族（hover 高亮）
 *   - edgeFamilyAreas                  : 拖动分界线时须整体平移的矩形族
 *   - snapCoord                        : 拖拽吸附（12 分格 + 对侧边界对齐）
 *
 * 坐标系：**归一化比例坐标 [0,1]×[0,1]**（原点左下，y 向上、x 向右；渲染层再与 DOM 翻转）。
 *
 * ⚠ 不变式：相邻矩形的公共边界坐标来自同一处计算（split 的切分值写进两侧矩形；
 * applySnapshot 恢复时同一坐标原样写回），故邻接判定、线族传播用 `===` 精确比较；
 * 仅外部来源（快照反序列化）引入浮点误差处，用 EPS(1e-9) 与 toFixed(6) 容差兜底。
 */

/** 二维坐标点(归一化比例坐标)
 * @category 几何
 */
export interface Vec2 { x: number; y: number }
/** 轴对齐矩形(含派生的 width/height，改边请走 withRect)
 * @category 几何
 */
export interface Rect {
  xmin: number; ymin: number; xmax: number; ymax: number;
  width: number; height: number;
}
/** 区域：矩形平铺的最小单元，rect 即其几何
 * @category 几何
 */
export interface Area {
  id: number;
  rect: Rect;
  contentType: string;
}
/** 屏幕：一次布局的全部区域，即快照的重建目标
 * @category 几何
 */
export interface Screen {
  areas: Area[];
  _id: number;
}
/** 推导分界线段：两相邻矩形公共边界的重叠段(只读派生数据，不持久化)
 * @category 几何
 */
export interface Seg { id: number; v1: Vec2; v2: Vec2 }
/** 分界线命中结果
 * @category 几何
 */
export interface EdgeHit { seg: Seg; dir: Axis }
/** 线族成员：area 触及该线，side 表示其位于坐标较小/较大一侧(min 侧矩形以内边 xmax 触线，max 侧以 xmin 触线)
 * @category 几何
 */
export interface FamilyMember { area: Area; side: "min" | "max" }

/** 分割/拖拽方向常量：H=水平分割线(上下切)，V=垂直分割线(左右切)
 * @category 几何
 */
export const AXIS = { H: "H", V: "V" } as const;
/** 分割/拖拽方向："H" | "V"
 * @category 几何
 */
export type Axis = (typeof AXIS)[keyof typeof AXIS];

/** 区域最小宽度(归一化比例)，分割与拖拽都不得低于此值
 * @category 几何
 */
export const MIN_AREA_W = 0.06;
/** 区域最小高度(归一化比例)
 * @category 几何
 */
export const MIN_AREA_H = 0.06;
/** 分界线命中容差(归一化比例)，指针距线段小于该值视为命中
 * @category 几何
 */
export const EDGE_TOLERANCE = 0.005;
/** 比例空间浮点容差(外部来源/反序列化引入的误差) */
const EPS = 1e-9;

/* ---------------------------------------------------------------- 数据结构 --- */
/** 创建空屏幕(无任何区域)
 * @category 几何
 */
export function createScreen(): Screen {
  return { areas: [], _id: 1 };
}
/** 由四边构造矩形(重算派生字段)；非有限坐标直接抛错——NaN/Infinity 一旦入库
 *  会被派生字段、邻接判定与快照链路静默放大，故在几何层入口统一拒绝。
 * @category 几何
 */
export function rect(xmin: number, ymin: number, xmax: number, ymax: number): Rect {
  if (!Number.isFinite(xmin) || !Number.isFinite(ymin) || !Number.isFinite(xmax) || !Number.isFinite(ymax)) {
    throw new Error(`无效的矩形坐标(须为有限值): [${xmin}, ${ymin}, ${xmax}, ${ymax}]`);
  }
  return { xmin, ymin, xmax, ymax, width: xmax - xmin, height: ymax - ymin };
}
/** 向屏幕添加一个区域
 *  @param s 目标屏幕
 *  @param r 区域矩形
 *  @param contentType 内容类型标识(默认 "general")
 *  @returns 新建的区域 */
export function addArea(s: Screen, r: Rect, contentType = "general"): Area {
  const a: Area = { id: s._id++, rect: withRect(r, {}), contentType };
  s.areas.push(a);
  return a;
}

/** 区域内矩形。v 与旧模型兼容保留 screen 参数
 *  @param _s 屏幕当前仅作签名占位
 *  @param a 目标区域
 *  @returns 区域矩形 */
export function areaRect(_s: Screen, a: Area): Rect {
  return a.rect;
}

/** 派生字段安全的矩形替换：改单边后重算 width/height。
 *  Rect 的 width/height 是由四边推导的冗余字段，`{ ...r, xmax: ... }` 这类
 *  spread 直改会让派生字段失真——凡改边一律走本函数(坐标校验委托 rect)。
 *  @param r 原矩形
 *  @param patch 要替换的边(未提供的边保持原值)
 *  @returns 派生字段已重算的新矩形
 * @category 几何 */
export function withRect(r: Rect, patch: Partial<Pick<Rect, "xmin" | "ymin" | "xmax" | "ymax">>): Rect {
  return rect(
    patch.xmin ?? r.xmin,
    patch.ymin ?? r.ymin,
    patch.xmax ?? r.xmax,
    patch.ymax ?? r.ymax,
  );
}

/** 矩形四角坐标(左下/左上/右上/右下)，用于角标去重与共享角点判定 */
function corners(r: Rect): [number, number][] {
  return [[r.xmin, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax], [r.xmax, r.ymin]];
}

/** 角点归一化键：toFixed(6) 吸收外部来源(快照反序列化)的浮点误差，
 *  findSharedEdge 与 joinAreas 共用同一容差口径(内部来源坐标位级一致，行为不变) */
function cornerKey(p: [number, number]): string {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
}

/* ------------------------------------------------------------ 查询(layout) --- */
/** 命中检测：坐标落在哪个区域内
 *  @param s 目标屏幕
 *  @param x 查询点 x(归一化比例)
 *  @param y 查询点 y(归一化比例)
 *  @returns 命中的区域；无命中返回 null
 * @category 几何
 */
export function findAreaAtXY(s: Screen, x: number, y: number): Area | null {
  for (const a of s.areas) {
    const r = a.rect;
    if (x >= r.xmin && x <= r.xmax && y >= r.ymin && y <= r.ymax) return a;
  }
  return null;
}

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
 *  @param tol 命中容差(默认 EDGE_TOLERANCE)
 *  @returns 命中的线段及其方向；无命中返回 null
 * @category 几何
 */
export function findEdgeAtPos(s: Screen, x: number, y: number, tol = EDGE_TOLERANCE): EdgeHit | null {
  let best: Seg | null = null, bestDist = Infinity;
  for (const seg of deriveEdges(s)) {
    const d = distToSeg(x, y, seg.v1.x, seg.v1.y, seg.v2.x, seg.v2.y);
    if (d <= tol && d <= bestDist) { bestDist = d; best = seg; }
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

/* ------------------------------------------------------------ 算法 A: 分割点 --- */
/** 计算分割线在区域内的落点，落点被夹逼在 [起点+最小尺寸, 终点-最小尺寸] 区间内。
 *  @param area 被分割的区域
 *  @param dir 分割方向
 *  @param fac 分割比例(0..1，自区域起点起算，越界自动收拢)
 *  @returns 分割线坐标(x 或 y，取决于 dir)；区域不足以分割时返回 null
 * @category 几何
 */
export function splitCoord(area: Area, dir: Axis, fac: number): number | null {
  const r = area.rect;
  const size = dir === AXIS.V ? r.width : r.height;
  const min = dir === AXIS.V ? MIN_AREA_W : MIN_AREA_H;
  if (size <= 2 * min) return null;

  const base = dir === AXIS.V ? r.xmin : r.ymin;
  const f = Math.min(1, Math.max(0, fac));
  return Math.min(base + size - min, Math.max(base + min, base + f * size));
}

/* ------------------------------------------------------------ 算法 B: 分割 --- */
/** 把一个区域按比例一分为二：原区域收缩保留较大部分，新增较小半块
 *  @param s 目标屏幕(就地修改)
 *  @param area 被分割的区域(fac ≤ 0.5 时保留上/右半，否则保留下/左半——即始终保留较大部分)
 *  @param dir 分割方向
 *  @param fac 分割比例(0..1)
 *  @returns 新增的那半块区域；区域不足以分割返回 null */
export function split(s: Screen, area: Area, dir: Axis, fac: number): Area | null {
  const coord = splitCoord(area, dir, fac);
  if (coord === null) return null;
  const r = area.rect;

  let newArea: Area;
  if (dir === AXIS.H) {
    if (fac > 0.5) {
      newArea = addArea(s, rect(r.xmin, coord, r.xmax, r.ymax), area.contentType);
      area.rect = withRect(r, { ymax: coord });
    } else {
      newArea = addArea(s, rect(r.xmin, r.ymin, r.xmax, coord), area.contentType);
      area.rect = withRect(r, { ymin: coord });
    }
  } else {
    if (fac > 0.5) {
      newArea = addArea(s, rect(coord, r.ymin, r.xmax, r.ymax), area.contentType);
      area.rect = withRect(r, { xmax: coord });
    } else {
      newArea = addArea(s, rect(r.xmin, r.ymin, coord, r.ymax), area.contentType);
      area.rect = withRect(r, { xmin: coord });
    }
  }
  return newArea;
}

/* ------------------------------------------------------------ 算法: 区域合并 --- */
/** 合并共享完整边界的两个区域为一块(以 keep 为承载，remove 被吞并)
 *  @param s 目标屏幕(就地修改)
 *  @param keep 保留的区域(合并后其矩形扩张为并集)
 *  @param remove 被吞并的区域(从 screen.areas 移除)
 *  @returns 合并后的 keep；不共享完整边界/并集不是矩形时返回 null
 * @category 几何
 */
export function joinAreas(s: Screen, keep: Area, remove: Area): Area | null {
  if (keep === remove || !findSharedEdge(s, keep, remove)) return null;
  const k = keep.rect, r = remove.rect;
  const xmin = Math.min(k.xmin, r.xmin), xmax = Math.max(k.xmax, r.xmax);
  const ymin = Math.min(k.ymin, r.ymin), ymax = Math.max(k.ymax, r.ymax);
  const unionArea = (xmax - xmin) * (ymax - ymin);
  if (Math.abs(unionArea - (k.width * k.height + r.width * r.height)) > EPS) return null;

  const map = new Map<string, [number, number]>();
  for (const a of [keep, remove]) for (const c of corners(a.rect)) map.set(cornerKey(c), c);
  const v1 = map.get(cornerKey([xmin, ymin])), v2 = map.get(cornerKey([xmin, ymax]));
  const v3 = map.get(cornerKey([xmax, ymax])), v4 = map.get(cornerKey([xmax, ymin]));
  if (!v1 || !v2 || !v3 || !v4) return null;

  keep.rect = rect(xmin, ymin, xmax, ymax);
  s.areas = s.areas.filter((a) => a !== remove);
  return keep;
}

/* ------------------------------------------------- 线族(推导边的连通/拖拽) --- */
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

/* ------------------------------------------------------------ 算法 D: 吸附 --- */
/** 拖拽吸附：汇总全部吸附候选点，取距拖拽落点最近者。
 *  候选来源：① 行程区间(可达范围的并集)的 12 等分格点；② 与 src 任一角点
 *  正交对齐的其它区域边界线(仅取行程区间内者，src 自身不作为候选)。
 *  @param s 目标屏幕
 *  @param src 被拖拽的源区域
 *  @param delta 指针位移量(相对拖拽起点)
 *  @param origin 被拖边的初始坐标
 *  @param dir 拖拽方向
 *  @param ahead 沿拖拽方向的行程余量(到边界/邻边的距离)
 *  @param behind 反方向的行程余量
 *  @returns 吸附后的新坐标；无候选返回 null
 * @category 几何
 */
export function snapCoord(
  s: Screen, src: Area, delta: number, origin: number, dir: Axis, ahead: number, behind: number,
): number | null {
  const target = origin + delta;
  const lo = origin - behind;
  const span = ahead + behind;
  const cross = (c: [number, number]) => (dir === AXIS.V ? c[1] : c[0]);
  const along = (c: [number, number]) => (dir === AXIS.V ? c[0] : c[1]);

  const candidates: number[] = [];
  for (let i = 0; i <= 12; i++) candidates.push(lo + span * (i / 12));

  const srcCross = new Set(corners(src.rect).map(cross));
  for (const a of s.areas) {
    if (a === src) continue;
    for (const c of corners(a.rect)) {
      if (!srcCross.has(cross(c))) continue;
      const p = along(c);
      if (lo < p && p < lo + span) candidates.push(p); // 开区间：不吸附到行程端点
    }
  }

  let best: number | null = null, bestDist = Infinity;
  for (const p of candidates) {
    const d = Math.abs(target - p);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}
