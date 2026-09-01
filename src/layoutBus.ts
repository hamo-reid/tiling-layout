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
 *
 * 投递时机：**微任务折叠**。store 订阅只置脏并调度一次 queueMicrotask，flush 时
 * 统一取最新状态计算指纹——一次用户操作(如 cornerUp 先改 areaStore 再改
 * layoutStore)产生的多份中间态 setState 折叠为一次事件，订阅方永远读到操作
 * 完成后的一致快照，不会拿到 contentType 与实例状态错配的中间态。回调内抛错
 * 被隔离(不中断其余订阅者、不反噬 store 调用方)。
 */
/** 数据变化事件：当前活跃布局 id + 该布局的完整快照
 * @category 事件总线
 */
export interface LayoutEvent {
  activeId: string;
  snapshot: LayoutSnapshot;
}
/** 订阅回调：evt 为当前事件，prev 为上一次事件(首次触发为 null)。
 *  注意两点：
 *  1. 回调在微任务中异步投递(同 tick 的多次变更折叠为一次)，需要同步响应时
 *     请改读 getSnapshot()。
 *  2. 回调内**勿写回任一 store**：若写入改变了数据指纹(areas/areaStates/shared/
 *     activeId)，会再次调度 flush → 再次触发本回调，形成微任务级自持循环并
 *     饿死事件循环；幂等写回(指纹不变)至多多派发一次后停止，但也应避免。
 * @category 事件总线
 */
export type Listener = (evt: LayoutEvent, prev: LayoutEvent | null) => void;

const listeners = new Set<Listener>();
let prev: LayoutEvent | null = null;
let scheduled = false;

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

function flush(): void {
  scheduled = false;
  const cur = compute();
  if (prev && key(cur) === key(prev)) return; // 无实质变化(仅 UI 态波及) → 不触发
  const p = prev;
  prev = cur;
  for (const fn of [...listeners]) {
    try {
      fn(cur, p);
    } catch (err) {
      // 单个订阅者异常不中断其余订阅者，也不反噬 store 的 setState 调用方
      console.error("[tiling-layout] layoutBus 订阅回调抛错:", err);
    }
  }
}

function emit(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

// 四份 store 任一变化都置脏(指纹在 flush 时统一去重)；emit 无参，包一层箭头以适配各 store 的 listener 签名
useLayout.subscribe(() => emit());
useAreaState.subscribe(() => emit());
useScene.subscribe(() => emit());
useWorkspaces.subscribe(() => emit());

export const layoutBus = {
  /** 订阅布局变化：回调 (当前, 上一次)。微任务异步投递，同 tick 多次变更折叠为一次。
   *  返回取消订阅函数
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
  /** 取当前快照(供命令式读取/需要同步语义的场合)
   *  @returns 当前活跃布局 id + 快照 */
  getSnapshot: compute,
};
