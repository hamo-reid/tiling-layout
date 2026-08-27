import { useLayout } from "./layoutStore";
import { setAreaState, useAreaState } from "./areaStore";
import type { AreaState } from "./areaStore";
import { sceneActions, useScene } from "./sceneStore";
import { useWorkspaces } from "./workspaces";
import { serializeLayout } from "./layoutData";
import { layoutBus } from "./layoutBus";

/**
 * useLayoutData — 布局库的统一门面 hook。
 * 把内部三份 store(几何 / 每区域实例 / 共享) + 多布局管理收敛到**单一入口**，
 * 供库使用者按一致 API 读取与操作，而无需知道内部是哪些 store。
 * UI 渲染组件仍可自行读子-store；对外 API 走此处。
 * @returns 门面对象：
 *   - 多布局：`activeId` / `layouts` / `switchTo(id)` / `createLayout(name?)` / `removeLayout(id?)`
 *   - 数据三视图：`screen`(几何) / `areaStates`(实例状态 map) / `shared`(共享场景数据)
 *   - 操作：`undo` / `redo` / `restore(snap)` / `serialize()` /
 *     `setAreaContent(id, type)` / `setAreaState(id, type, patch)` / `moveMesh(dx)`
 *   - 订阅回调：`onChange(fn)` / `subscribe(fn)` / `getSnapshot()`
 * @category 状态机与门面
 */
export function useLayoutData() {
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