/**
 * geometry/layout.ts — 命中、分割、合并、拖拽吸附(纯函数,无 React/DOM)。
 *
 * 分割把切分值同时写进两侧矩形，故相邻边界坐标位级一致，邻接判定可用 `===`。
 */
import { AXIS, EPS, addArea, cornerKey, corners, rect, withRect } from "./types";
import type { Area, Axis, Screen } from "./types";
import { findSharedEdge } from "./edges";
import { runtime } from "../runtimeConfig";

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
  const rt = runtime();
  const min = dir === AXIS.V ? rt.minAreaW : rt.minAreaH;
  if (size <= 2 * min) return null;

  const base = dir === AXIS.V ? r.xmin : r.ymin;
  const f = Math.min(1, Math.max(0, fac));
  return Math.min(base + size - min, Math.max(base + min, base + f * size));
}

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

/** 拖拽吸附：汇总全部吸附候选点，取距拖拽落点最近者。
 *  候选来源：① 行程区间(可达范围的并集)的 N 等分格点(runtime().snapDivisions)；② 与 src 任一角点
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
  const div = runtime().snapDivisions;
  for (let i = 0; i <= div; i++) candidates.push(lo + span * (i / div));

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
