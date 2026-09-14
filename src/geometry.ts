/**
 * geometry.ts — 几何层公开入口(barrel)。
 *
 * **矩形平铺模型**：布局即一组轴对齐、互不重叠、铺满舞台的矩形（Area.rect）。
 * 分界线不再持久存储 —— 由相邻矩形的公共边界推导（deriveEdges），渲染/命中/拖拽
 * 全部消费推导结果；网格一致性（共享边、T 型分段、悬空点清理）因此天然成立。
 *
 * 实现按职责拆到 `geometry/` 子模块，本文件只做公开面的统一出口(消费方仍
 * `from "./geometry"` 或经 public-api，无需感知内部拆分)：
 *   - `geometry/types.ts`  : 类型/常量/矩形数据结构
 *   - `geometry/edges.ts`  : deriveEdges / findEdgeAtPos / 共享边 / 连通线族
 *   - `geometry/layout.ts` : findAreaAtXY / splitCoord / split / joinAreas / snapCoord
 *
 * 坐标系：**归一化比例坐标 [0,1]×[0,1]**（原点左下，y 向上、x 向右；渲染层再与 DOM 翻转）。
 *
 * ⚠ 不变式：相邻矩形的公共边界坐标来自同一处计算（split 的切分值写进两侧矩形；
 * applySnapshot 恢复时同一坐标原样写回），故邻接判定、线族传播用 `===` 精确比较；
 * 仅外部来源（快照反序列化）引入浮点误差处，用 EPS(1e-9) 与 toFixed(6) 容差兜底。
 */
export {
  AXIS, MIN_AREA_W, MIN_AREA_H, EDGE_TOLERANCE,
  createScreen, rect, addArea, areaRect, withRect,
} from "./geometry/types";
export type { Vec2, Rect, Area, Screen, Seg, EdgeHit, FamilyMember, Axis } from "./geometry/types";
export {
  deriveEdges, findEdgeAtPos, findSharedEdge, isBoundaryAdjacent, connectedSegs, edgeFamilyAreas,
} from "./geometry/edges";
export {
  findAreaAtXY, splitCoord, split, joinAreas, snapCoord,
} from "./geometry/layout";
