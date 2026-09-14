/**
 * geometry/types.ts — 几何基础:类型、常量与矩形数据结构(纯函数,无 React/DOM)。
 *
 * 坐标系：归一化比例 [0,1]×[0,1](原点左下,y 向上、x 向右;渲染层再与 DOM 翻转)。
 * 本文件是几何层的叶子依赖(不 import 兄弟子模块),供 edges/layout 复用。
 */
import { RUNTIME_DEFAULTS } from "../runtimeConfig";

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

/** 区域最小宽度(归一化比例)默认值；运行时经 configureRuntime 调整，分割/拖拽实际读 runtime()
 * @category 几何
 */
export const MIN_AREA_W = RUNTIME_DEFAULTS.minAreaW;
/** 区域最小高度(归一化比例)默认值；运行时经 configureRuntime 调整
 * @category 几何
 */
export const MIN_AREA_H = RUNTIME_DEFAULTS.minAreaH;
/** 分界线命中容差(归一化比例)默认值；运行时经 configureRuntime 调整
 * @category 几何
 */
export const EDGE_TOLERANCE = RUNTIME_DEFAULTS.hitTolerance;
/** 比例空间浮点容差(外部来源/反序列化引入的误差) @internal */
export const EPS = 1e-9;

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

/** 矩形四角坐标(左下/左上/右上/右下)，用于角标去重与共享角点判定 @internal */
export function corners(r: Rect): [number, number][] {
  return [[r.xmin, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax], [r.xmax, r.ymin]];
}

/** 角点归一化键：toFixed(6) 吸收外部来源(快照反序列化)的浮点误差，
 *  findSharedEdge 与 joinAreas 共用同一容差口径(内部来源坐标位级一致，行为不变) @internal */
export function cornerKey(p: [number, number]): string {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
}
