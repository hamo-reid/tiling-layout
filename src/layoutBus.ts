import { useLayout } from "./layoutStore";
import { useAreaState } from "./areaStore";
import { useScene } from "./sceneStore";
import { useWorkspaces } from "./workspaces";
import { collectSnapshot } from "./layoutData";
import type { LayoutSnapshot } from "./layoutData";

/**
 * layoutBus — 布局"数据变化"事件总线(门面的订阅回调实现)。
 *
 * 合并订阅四份 store(几何/实例/共享/多布局)；对每次 set 计算"数据指纹"，
 * 只在指纹真正变化时触发 onChange(prev,next) —— 自动过滤掉 mode/status/preview 等
 * 瞬时 UI 噪音，只报"会落到持久化/外部引擎的实质变化"(结构调整、实例/共享改动、布局切换)。
 */
/** 数据变化事件：当前活跃布局 id + 该布局的完整快照
 * @category 事件总线
 */
export interface LayoutEvent {
  activeId: string;
  snapshot: LayoutSnapshot;
}
/** 订阅回调：evt 为当前事件，prev 为上一次事件(首次触发为 null)
 * @category 事件总线
 */
export type Listener = (evt: LayoutEvent, prev: LayoutEvent | null) => void;

const listeners = new Set<Listener>();
let prev: LayoutEvent | null = null;

function compute(): LayoutEvent {
  return {
    activeId: useWorkspaces.getState().activeId,
    snapshot: collectSnapshot(useLayout.getState().screen),
  };
}
function key(e: LayoutEvent): string {
  // 指纹只比对数据本体(meta 含 savedAt 时间戳，必须排除，否则永远去不了重)
  const s = e.snapshot;
  const core = JSON.stringify({
    a: s.areas, st: s.areaStates, sh: s.shared,
  });
  return e.activeId + "|" + core;
}

function emit(): void {
  const cur = compute();
  if (prev && key(cur) === key(prev)) return; // 无实质变化(仅 UI 态波及) → 不触发
  const p = prev;
  prev = cur;
  for (const fn of [...listeners]) fn(cur, p);
}

// 四份 store 任一变化都走 emit(指纹去重)；emit 无参，包一层箭头以适配各 store 的 listener 签名
useLayout.subscribe(() => emit());
useAreaState.subscribe(() => emit());
useScene.subscribe(() => emit());
useWorkspaces.subscribe(() => emit());

export const layoutBus = {
  /** 订阅布局变化：回调 (当前, 上一次)。返回取消订阅函数
   *  @param fn 变化回调
   *  @returns 取消订阅函数 */
  onChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  /** 别名：与 onChange 相同(门面对外统一语义)
   *  @param fn 变化回调
   *  @returns 取消订阅函数 */
  subscribe: (fn: Listener) => layoutBus.onChange(fn),
  /** 取当前快照(供命令式读取)
   *  @returns 当前活跃布局 id + 快照 */
  getSnapshot: compute,
};