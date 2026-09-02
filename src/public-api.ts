/**
 * public-api.ts — 库「公开面」白名单(唯一受控出口)。
 * TypeDoc 以本文件为入口自动生成 API 参考；index 亦由此重导出，保证文档与对外签名一致。
 */

// 几何(纯函数 + 类型)——矩形平铺模型
export {
  createScreen, addArea, rect, areaRect, withRect,
  findAreaAtXY, findEdgeAtPos, findSharedEdge, isBoundaryAdjacent,
  splitCoord, split, joinAreas,
  deriveEdges, connectedSegs, edgeFamilyAreas, snapCoord,
  AXIS, MIN_AREA_W, MIN_AREA_H, EDGE_TOLERANCE,
} from "./geometry";
export type { Screen, Area, Seg, Rect, Axis, Vec2, EdgeHit, FamilyMember } from "./geometry";

// 默认屏幕
export { buildInitialScreen, CONTENT } from "./screen";

// 每区域实例状态
export {
  useAreaState, getAreaState, setAreaState,
  cloneAreaState, swapAreaState, moveAreaState, removeAreaStates, removeAreaStatesByType,
  useAreaInstance,
} from "./areaStore";
export type { AreaState, AreaSlots, AreaStateStore } from "./areaStore";

// 共享场景
export { useScene, sceneActions } from "./sceneStore";
export type { MeshObject, SceneState } from "./sceneStore";

// 统一快照 / 版本迁移
export {
  collectSnapshot, applySnapshot, migrateSnapshot, serializeLayout, SNAPSHOT_VERSION,
} from "./layoutData";
export type { LayoutSnapshot, AreaSnap, LayoutMeta } from "./layoutData";

// 订阅回调
export { layoutBus } from "./layoutBus";
export type { LayoutEvent, Listener } from "./layoutBus";

// 状态机 / 门面
// ⚠ 引用语义契约：screen 几何采用「原地 mutate + 顶层浅拷贝」触发重渲
// (见 layoutStore 头注)。订阅请以 useLayout(s => s.screen) 等**顶层对象**为
// selector——按 s.screen.areas 或单个 Area 对象订阅在几何变更后不会重渲
// (数组/对象引用不变，zustand 按 Object.is 判等)。细粒度实例状态请走
// useAreaInstance / useLayoutData。
export { useLayout } from "./layoutStore";
export type { LayoutStore, DockTarget, DockState, ResizeCtx } from "./layoutStore";
export { useLayoutData } from "./useLayoutData";
export type { LayoutDataApi } from "./useLayoutData";

// 多布局(工作区)
export { useWorkspaces, serializeWorkspaces, deserializeWorkspaces, WORKSPACES_KEY } from "./workspaces";
export type { LayoutInfo, WSStore, WorkspaceData } from "./workspaces";

// 内容注册 / 渲染 / 主题
// (clearContentRegistry 为 @internal：测试/热重载用，不进入公开面)
export {
  Content, registerContent, unregisterContent, getContentTitle,
} from "./registry";
export type { ContentProps, ContentDef, ContentLifecycleCtx } from "./registry";
export { getAreaComponent, getComponentsByType } from "./areaInstances";
export type { AreaComponentInfo } from "./areaInstances";
export { LayoutViewDom } from "./LayoutViewDom";
export type { RenderSlots, LayoutViewDomProps } from "./LayoutViewDom";
export { LayoutProvider } from "./LayoutProvider";
export type { LayoutProviderProps } from "./LayoutProvider";
export { configToCssVars, SPACING_DEFAULTS, SIZING_DEFAULTS } from "./theme";
export type { LayoutConfig } from "./theme";

// 声明式初始布局引导(替换默认布局 + 内联内容定义自动注册)
export { installInitialLayout, isPristineScreen, isLayoutBootstrapped } from "./initialLayout";
export type { InitialLayout, InitialSnapshot, InitialArea } from "./initialLayout";