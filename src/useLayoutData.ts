import { useLayout } from "./layoutStore";
import { setAreaState, useAreaState } from "./areaStore";
import type { AreaState, AreaStateStore } from "./areaStore";
import { sceneActions, useScene } from "./sceneStore";
import type { MeshObject } from "./sceneStore";
import { useWorkspaces } from "./workspaces";
import type { LayoutInfo } from "./workspaces";
import { serializeLayout } from "./layoutData";
import type { Screen } from "./geometry";
import { layoutBus } from "./layoutBus";

/**
 * useLayoutData — 布局库的统一门面 hook。
 * 把内部三份 store(几何 / 每区域实例 / 共享) + 多布局管理收敛到**单一入口**，
 * 供库使用者按一致 API 读取与操作，而无需知道内部是哪些 store。
 * UI 渲染组件仍可自行读子-store；对外 API 走此处。
 */
/** 门面 hook 的返回类型(具名导出，消费方无需 typeof 推导)
 * @category 状态机与门面
 */
export interface LayoutDataApi {
  // —— 多布局(工作区) ——
  /** 当前活跃布局 id */
  activeId: string;
  /** 全部布局条目(id/名称) */
  layouts: LayoutInfo[];
  /** 切换到指定布局(先存档当前活跃再恢复目标) */
  switchTo: (id: string) => void;
  /** 以当前布局为模板新建布局，返回新布局 id */
  createLayout: (name?: string) => string;
  /** 删除布局(缺省删除当前活跃；仅剩一个时无操作) */
  removeLayout: (id?: string) => void;

  // —— 数据三视图 ——
  /** 当前屏幕几何(引用语义：浅拷贝顶层触发重渲) */
  screen: Screen;
  /** 实例状态总表 map[areaId][contentType] */
  areaStates: AreaStateStore["map"];
  /** 共享场景数据(全局一份) */
  shared: MeshObject;

  // —— 操作 ——
  /** 撤销上一步 */
  undo: () => void;
  /** 重做 */
  redo: () => void;
  /** 恢复任意来源的快照数据(内部经 migrateSnapshot 校验归一) */
  restore: (snap: unknown) => void;
  /** 当前布局序列化为 JSON 字符串 */
  serialize: () => string;
  /** 程序化切换区域内容(进历史栈) */
  setAreaContent: (id: number, type: string) => void;
  /** 增量写某区域某类型的实例状态 */
  setAreaState: (id: number, type: string, patch: AreaState) => void;
  /** 移动共享场景物体(全局共享，所有视图同步) */
  moveMesh: (dx: number) => void;

  // —— 订阅回调(数据实质变化，微任务折叠投递) ——
  /** 订阅布局变化，返回取消订阅函数 */
  onChange: typeof layoutBus.onChange;
  /** onChange 别名 */
  subscribe: typeof layoutBus.subscribe;
  /** 命令式读取当前活跃布局 id + 快照 */
  getSnapshot: typeof layoutBus.getSnapshot;
}

/**
 * 布局库的统一门面 hook(返回结构见 {@link LayoutDataApi})。
 * @returns 门面对象
 * @category 状态机与门面
 */
export function useLayoutData(): LayoutDataApi {
  const screen = useLayout((s) => s.screen);
  const activeId = useWorkspaces((s) => s.activeId);
  const list = useWorkspaces((s) => s.list);
  const areaStates = useAreaState((s) => s.map);
  const shared = useScene((s) => s.mesh);

  const w = useWorkspaces.getState;
  const l = useLayout.getState;

  return {
    // —— 多布局(工作区) ——
    activeId,
    layouts: list,
    switchTo: (id: string) => w().switchTo(id),
    createLayout: (name?: string) => w().create(name),
    removeLayout: (id?: string) => w().remove(id),

    // —— 数据三视图 ——
    screen,
    areaStates,
    shared,

    // —— 操作 ——
    undo: () => l().undo(),
    redo: () => l().redo(),
    restore: (snap: unknown) => l().restore(snap),
    serialize: () => serializeLayout(l().screen),
    setAreaContent: (id: number, type: string) => l().setAreaContent(id, type),
    setAreaState: (id: number, type: string, patch: AreaState) => setAreaState(id, type, patch),
    moveMesh: (dx: number) => sceneActions.moveMesh(dx),

    // —— 订阅回调(数据实质变化) ——
    onChange: layoutBus.onChange,
    subscribe: layoutBus.subscribe,
    getSnapshot: layoutBus.getSnapshot,
  };
}
