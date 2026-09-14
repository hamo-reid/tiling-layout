/**
 * domPct.ts — 归一化比例 → DOM 百分比盒的换算(渲染层内部共用)。
 */
import type { Rect } from "./geometry";

/** 归一化比例(0..1) → CSS 百分比字符串 */
export const pct = (n: number): string => `${+(n * 100).toFixed(4)}%`;

/** 归一化比例矩形 → DOM 百分比盒(含 y 翻转：top 用 1-ymax) */
export function boxPct(r: Rect): { left: string; top: string; width: string; height: string } {
  return {
    left: pct(r.xmin),
    top: pct(1 - r.ymax),
    width: pct(r.xmax - r.xmin),
    height: pct(r.ymax - r.ymin),
  };
}
