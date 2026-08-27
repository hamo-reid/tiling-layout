/**
 * areaInstances — 按 areaId 获取"当前存活"的组件信息(命令式)。
 *
 * Content 挂载时自动注册该区域的 DOM 容器节点，卸载时移除；外部因此可以按
 * areaId 或按 contentType 拿到仍在渲染中的组件 DOM(测量/样式/事件注入等)，
 * 不必穿透 React 组件树。函数组件在 React 18 下无命令式实例，故注册表提供的是
 * 该区域内容容器的 DOM 节点(始终可用)；如需暴露"方法级句柄"，由组件自行配合。
 * @category 渲染与主题
 */
export interface AreaComponentInfo {
  areaId: number;
  contentType: string;
  /** 该区域内容容器 DOM 节点(挂载期间有效；卸载后查询不到) */
  el: HTMLElement;
}

const registry = new Map<number, AreaComponentInfo>();

/** @internal Content 挂载时调用
 * @category 渲染与主题
 */
export function registerAreaInstance(info: AreaComponentInfo): void {
  registry.set(info.areaId, info);
}
/** @internal Content 卸载时调用
 * @category 渲染与主题
 */
export function unregisterAreaInstance(areaId: number): void {
  registry.delete(areaId);
}
/** @internal 清空注册表(测试/热重载用)
 * @category 渲染与主题
 */
export function clearAreaInstances(): void {
  registry.clear();
}

/** 按 areaId 取当前存活组件；未挂载/已卸载返回 null
 *  @param areaId 区域 id
 *  @returns 组件信息(含内容容器 DOM)；不存在返回 null */
export function getAreaComponent(areaId: number): AreaComponentInfo | null {
  return registry.get(areaId) ?? null;
}

/** 按 contentType 取当前存活的全部组件(含各自 areaId)，按 areaId 升序
 *  @param contentType 内容类型标识
 *  @returns 存活组件信息列表 */
export function getComponentsByType(contentType: string): AreaComponentInfo[] {
  return [...registry.values()]
    .filter((c) => c.contentType === contentType)
    .sort((a, b) => a.areaId - b.areaId);
}
