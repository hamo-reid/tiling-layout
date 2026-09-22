/**
 * store/shared.ts — 手势 action 之间共享的纯辅助(内容名/不可变重标/停靠吸附/侧标签)
 * 与**唯一的落地入口** `landPatch`。
 *
 * 仅被 layoutStore 组装层与 store/* 手势模块引用;对类型做 type-only 引用(不产生运行环)。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { getContentTitle } from "../registry";
import { collectSnapshot } from "../layoutData";
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

/* ---------------- 落地：唯一的入栈点 ---------------- */

/** 手势残留的一键清空。程序化命令会整体换掉 areas 数组，任何在手势中间态里持有的
 *  `Area` 引用随即失效(`cancel` 会往孤对象上写 rect)，所以命令落地时**必须**清。 */
export const IDLE_GESTURE = {
  mode: "idle",
  srcId: null,
  hoverTId: null,
  splitDir: null,
  snapped: false,
  resize: null,
  dock: null,
} as const;

/** 变更前快照(仅实际变化时入栈)。凡可能改几何/内容的动作，在动手之前取一次。 */
export function beginMutation(screen: G.Screen): string {
  return JSON.stringify(collectSnapshot(screen));
}

export interface LandInput {
  /** 落地后的屏幕(几何已就地改好，或换成 retype 的新数组) */
  readonly screen: G.Screen;
  /** 内容类型变化(不可变落地)；缺省表示本动作不改 contentType */
  readonly retype?: Map<number, string>;
  /** 状态栏文字 */
  readonly status: string;
  /** `beginMutation` 的产物 */
  readonly pre: string;
  /** 是否实际发生变化(纯取消/空操作不得污染 undo) */
  readonly mutated: boolean;
  /** 'snapshot'(默认) = 变化即入栈；'none' = 显式豁免(视图态/恢复自身) */
  readonly history?: "snapshot" | "none";
}

/**
 * 计算一次布局写入的落地补丁：屏幕(含 retype 落地)、状态栏、**历史**。
 *
 * 这是全库唯一的入栈口。此前 `setAreaContent` 走 `commitHistory()`、三个手势各自
 * 手写 `past: [...st.past, pre]`，调用方还得知道"这个动作是不是已经压过了"；
 * 现在一律经此处，规则只有一条：**history==='snapshot' 且 mutated 才压栈**。
 *
 * `history: 'none'` 是显式豁免而非疏漏 —— 最大化/退出最大化是渲染层视图态
 * (不改几何与快照，切换/恢复布局时清空)，`restore` 自身就是恢复目标，
 * 它们都不该产生撤销项。
 *
 *  @param st 当前 store 快照(取 past/future 的现值)
 *  @param input 本次写入的屏幕/重标/状态/前快照/是否变化/历史档
 *  @returns 可直接展开进 `set(...)` 的补丁(手势残留字段由各 action 自己补)
 */
export function landPatch(st: LayoutStore, input: LandInput): Partial<LayoutStore> {
  const { screen, retype, status, pre, mutated } = input;
  const push = (input.history ?? "snapshot") === "snapshot" && mutated;
  return {
    screen: retype === undefined ? { ...screen } : { ...screen, areas: retypedAreas(screen, retype) },
    status,
    past: push ? [...st.past, pre].slice(-runtime().historyMax) : st.past,
    future: push ? [] : st.future,
  };
}
