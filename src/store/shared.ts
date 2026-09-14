/**
 * store/shared.ts — 手势 action 之间共享的纯辅助(内容名/不可变重标/停靠吸附/侧标签)。
 *
 * 仅被 layoutStore 组装层与 store/* 手势模块引用;对类型做 type-only 引用(不产生运行环)。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { getContentTitle } from "../registry";
import type { DockTarget, LayoutStore } from "../layoutStore";

/** 内容类型的人读名(注册 title → CONTENT 表 → 类型原文) */
export const contentName = (t: string | undefined): string => getContentTitle(t ?? "general");

/** 内容类型变化不可变落地：按 (areaId → contentType) 生成新 Area 对象，原对象引用不变，
 *  细粒度 selector(按 contentType/对象引用订阅)不会漏更新。split/join 等几何变异不受影响。 */
export function retypedAreas(s: G.Screen, changes: Map<number, string>): G.Area[] {
  if (!changes.size) return s.areas;
  return s.areas.map((a) => {
    const t = changes.get(a.id);
    return t === undefined || t === a.contentType ? a : { ...a, contentType: t };
  });
}

/** 停靠槽占比吸附：靠近常用分格即对齐(网格经 configureRuntime 可调) */
export function snapFactor(v: number): number {
  const grid = runtime().dockSnap;
  let best = grid[0] ?? v;
  let bd = Math.abs(v - best);
  for (const t of grid) { const d = Math.abs(v - t); if (d < bd) { bd = d; best = t; } }
  return best;
}

/** 停靠方向的人读标签 */
export function sideLabel(t: DockTarget): string {
  return t === "left" ? "左侧" : t === "right" ? "右侧" : t === "top" ? "上方" : "下方";
}

/** 按 id 取当前屏幕里的区域(null/不存在 → null) */
export function areaById(get: () => LayoutStore, id: number | null): G.Area | null {
  return id == null ? null : get().screen.areas.find((a) => a.id === id) ?? null;
}

/** 由 splitLine 反算 factor(0..1)，供 split() 用 */
export function factorFromLine(get: () => LayoutStore, src: G.Area, dir: G.Axis, line: number): number {
  const r = G.areaRect(get().screen, src);
  const base = dir === G.AXIS.H ? r.ymin : r.xmin;
  const size = dir === G.AXIS.H ? r.height : r.width;
  return Math.max(0, Math.min(1, (line - base) / size));
}
