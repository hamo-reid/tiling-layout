import { Component, useCallback, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { create } from "zustand";
import { hasAreaState, removeAreaStatesByType, setAreaState, useAreaState } from "./areaStore";
import { getAreaComponent, getComponentsByType, registerAreaInstance, unregisterAreaInstance } from "./areaInstances";
import { CONTENT } from "./screen";

/**
 * registry — 内容类型注册表：每种 contentType 注册"标题 + 默认实例状态 + 渲染组件"。
 *
 * 通过 registerContent() 注册；T 由 defaults 推断并强制与 Comp 共享同一类型，
 * 组件收到的 state/setState 均为该类型，无需强转。组件内仍可通过 useScene 等
 * hook 访问共享层(共享数据按身份全局一份)。
 *
 * 实例状态本身存于 areaStore（按 areaId × contentType 双键分槽，随 split/join/swap/dock 迁移），
 * 这里只在组件渲染时按 (areaId, type) 桥接注入。
 *
 * 区域内容实例生命周期（区域几何创建/销毁由 layoutStore 负责，见 layoutStore/areaStore）：
 *   几何创建(G.addArea) → 首次渲染(defaults 注入 → onMount) → 存活期(setState 读写槽位)
 *   → 内容切换(旧类型 onUnmount → 新类型 onMount，状态分槽互不干扰)
 *   → 区域销毁(join/restore: onUnmount → ref 注销 → removeAreaStates)。
 *   → 类型注销(unregisterContent: 手动 onUnmount → removeAreaStatesByType)。
 * @category 渲染与主题
 */
export interface ContentProps<T = Record<string, unknown>> {
  areaId: number;
  /** 本区域实例状态（类型即注册时 defaults 的推断类型）。
   *  注意：defaults 在首帧渲染后的 useLayoutEffect 中注入，**首帧 render 时可能缺字段**，
   *  故读取端类型为 `Partial<T>`，组件必须对缺字段兜底（如 `state.view ?? 默认值`）。 */
  state: Partial<T>;
  /** 增量更新本区域实例状态（只接受本类型字段） */
  setState: (patch: Partial<T>) => void;
}

/** 生命周期回调上下文：el 为该区域内容容器 DOM(挂载期间有效；onUnmount 清理时仍可用)
 * @category 渲染与主题
 */
export interface ContentLifecycleCtx {
  /** 承载该内容的区域 id */
  areaId: number;
  /** 内容类型标识 */
  contentType: string;
  /** 该区域内容容器 DOM 节点(挂载期间有效；onUnmount 清理时仍可用) */
  el: HTMLElement;
}

export interface ContentDef<T extends object = Record<string, unknown>> {
  /** 内容类型标识，对应 screen.areas[].contentType */
  type: string;
  /** 区域头部标题；未提供时回退 CONTENT 表，再回退 type 原文 */
  title?: string;
  /** 每个该类型区域首次渲染时注入的实例状态默认值（同时决定 T） */
  defaults?: T;
  /** 渲染组件：收到的 state/setState 即该 (areaId, type) 槽位的实例状态 */
  Comp: (p: ContentProps<T>) => ReactNode;
  /** 面板挂载后调用(defaults 已注入)。同区域的 (areaId, type) 实例每次挂载触发一次 */
  onMount?: (ctx: ContentLifecycleCtx) => void;
  /** 面板卸载前调用，与 onMount 成对(切换类型/区域被吞并/restore 重建/类型被注销 unregisterContent)。
   *  时序保证：同区域切换类型时，旧类型 onUnmount 先于新类型 onMount。 */
  onUnmount?: (ctx: ContentLifecycleCtx) => void;
}

const registry = new Map<string, ContentDef<any>>();

/** @internal 注册表版本号：注册表本身是普通 Map 不具响应性，Content 订阅此版本，
 *  注册/注销/清空时递增 → 已挂载面板立即重渲染并按最新注册表渲染
 *  (热替换换组件、注销回退占位即时生效，与该类型是否有状态槽位无关)。 */
const useRegistryVersion = create<{ v: number }>(() => ({ v: 0 }));
const bumpRegistry = (): void => useRegistryVersion.setState((s) => ({ v: s.v + 1 }));

/** 注册一种内容类型。T 由 defaults 与 Comp 的参数共同约束，二者形状必须一致。
 *  重复注册同类型为 upsert：替换定义、保留实例状态(热替换，已挂载面板立即采用新定义)；
 *  彻底移除用 unregisterContent。
 *  @param def 内容类型定义(type/title/defaults/Comp/生命周期回调)
 * @category 渲染与主题
 */
export function registerContent<T extends object>(def: ContentDef<T>): void {
  registry.set(def.type, def as ContentDef<any>);
  bumpRegistry(); // 已挂载面板立即采用新定义(热替换即时生效)
}
/** @internal 按类型取注册定义；未注册返回 null
 *  @param type 内容类型标识 */
export function getContentDef(type: string): ContentDef<any> | null {
  return registry.get(type) ?? null;
}
/** 标题解析：注册 title → CONTENT 表 → type 原文
 *  @param type 内容类型标识
 *  @returns 该类型的展示标题
 * @category 渲染与主题
 */
export function getContentTitle(type: string): string {
  return registry.get(type)?.title ?? CONTENT[type] ?? type;
}
/** @internal 清空注册表(测试/热重载用)
 * @category 渲染与主题
 */
export function clearContentRegistry(): void {
  tornDownAreas.clear();
  registry.clear();
  bumpRegistry();
}

/** 「已被 unregisterContent 手动触发过 onUnmount」的实例，键 `${areaId}:${type}` 双键——
 *  一个类型的标记永远不会抑制另一类型的 onUnmount。生命周期 effect 的清理据此去重：
 *  注销时已 fan-out 过 onUnmount，之后真实卸载不再重复触发；清理时无条件消费同键标记，
 *  即使闭包 def 为 null(占位期间)也不让标记滞留。热替换(registerContent upsert)不写标记，
 *  真实卸载仍由挂载时的旧 def 成对清理(语义不变)。
 */
const tornDownAreas = new Set<string>();

/** 注销一种内容类型：移除注册定义，对当前存活的该类型实例逐个触发 onUnmount
 *  (ctx.el 此时仍有效，可安全释放三方资源)，并清空该类型在所有区域的实例状态槽位；
 *  注册表版本随之递增，挂载中的该类型面板立即重渲染、回退通用占位。
 *
 *  与 registerContent 分工：registerContent 是 upsert(保留实例状态)；本函数是 remove
 *  (定义 + 存活实例清理 + 状态随类型一并清除，其他类型的槽位不受影响)。
 *  时序：先删注册表(重渲染即查不到定义)→ fan-out onUnmount → 清槽；
 *  每个实例的 onUnmount 至多触发一次(真实卸载按 tornDownAreas 标记去重)。
 *  @param type 内容类型标识
 *  @returns 是否实际注销；类型未注册时为 no-op 并返回 false
 * @category 渲染与主题
 */
export function unregisterContent(type: string): boolean {
  const def = registry.get(type);
  if (!def) return false;
  registry.delete(type);
  if (def.onUnmount) {
    for (const info of getComponentsByType(type)) {
      // 快照循环期间，回调可能同步卸载/切走兄弟面板(flushSync 等)：仅对仍存活的实例触发，
      // 防止"真实清理已先行 + 循环补刀"的双重 onUnmount 与标记滞留
      if (getAreaComponent(info.areaId)?.contentType !== type) continue;
      tornDownAreas.add(`${info.areaId}:${type}`); // 先标记再回调：回调内自卸载也保证至多清理一次
      try {
        def.onUnmount({ areaId: info.areaId, contentType: type, el: info.el });
      } catch (err) {
        // 单实例回调异常不阻断其余实例与清槽(对齐 layoutBus 的订阅者隔离策略)
        console.error(`[tiling-layout] unregisterContent("${type}") 的 onUnmount 抛错:`, err);
      }
    }
  }
  removeAreaStatesByType(type);
  bumpRegistry(); // 版本递增 → 挂载中的面板立即重渲染回退占位(与该类型是否有槽位无关)
  return true;
}


/** 单区域错误边界：注册的组件抛错只降级本面板，不炸整个舞台 */
class AreaBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    if (this.state.err) {
      return (
        <div className="tl-acontent">
          <b>面板已崩溃</b>
          <small>{String(this.state.err.message ?? this.state.err)}</small>
        </div>
      );
    }
    return this.props.children;
  }
}

/** 通用渲染：按 contentType 命中注册组件并注入类型化实例状态；未注册则通用占位。
 *  挂载时把该区域内容容器注册进 areaInstances(供 getAreaComponent / getComponentsByType 查询)。
 *  @param props `type` 内容类型标识；`areaId` 承载该内容的区域 id
 * @category 渲染与主题
 */
export function Content({ type, areaId }: { type: string; areaId: number }) {
  // 订阅注册表版本：注册/注销变更注册表时触发重渲染，使下面的 def 查找即时生效
  useRegistryVersion((s) => s.v);
  const def = registry.get(type) ?? null;
  // 订阅本区域本类型的槽位；其他区域/其他类型的状态变化不触发本组件重渲染
  const raw = useAreaState((s) => s.map[areaId]?.[type]);
  const setState = useCallback(
    (patch: Record<string, unknown>) => setAreaState(areaId, type, patch),
    [areaId, type],
  );
  useLayoutEffect(() => {
    // paint 前注入 defaults：首帧即有完整状态(用户首帧交互不会丢字段)；
    // 该类型槽位已存在时不动(swap/move 迁移过来的实例状态不覆盖)。
    // def 入 deps：注销(unregisterContent)后再注册同类型时，仍挂载中的面板重新注入
    // defaults(hasAreaState 守卫保证不覆盖已有槽位)
    if (def?.defaults && !hasAreaState(areaId, type)) setAreaState(areaId, type, def.defaults);
  }, [type, areaId, def]);
  // ref 回调保持稳定：挂载/卸载只由 DOM 生命周期驱动，不随 type 变化 detach/attach
  const infoRef = useRef({ areaId, contentType: type });
  infoRef.current = { areaId, contentType: type };
  const elRef = useRef<HTMLElement | null>(null);
  const registerRef = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    if (el) registerAreaInstance({ ...infoRef.current, el });
    else unregisterAreaInstance(infoRef.current.areaId);
  }, []);
  // 内容实例生命周期 effect：注册信息刷新 + onMount/onUnmount 成对触发。
  // 同一次 commit 内 ref 先于 layout effect 挂好，elRef 必已就绪；切换类型时容器
  // 节点复用(仅子树重挂)，el 引用不变。React 保证本 effect 的清理先于下轮 effect，
  // 故“旧类型 onUnmount → 新类型 onMount”顺序成立；卸载时清理先于 ref detach，
  // 回调里注册表与 DOM 仍有效。
  useLayoutEffect(() => {
    const el = elRef.current;
    const info = getAreaComponent(areaId);
    if (info) registerAreaInstance({ areaId, contentType: type, el: info.el });
    if (def?.onMount && el) def.onMount({ areaId, contentType: type, el });
    return () => {
      // 无条件消费同 (areaId, type) 键的注销标记：闭包 def 为 null(占位期间)或无 onUnmount
      // 时也不让标记滞留漂移。注销(unregisterContent)已手动触发过 onUnmount(标记命中 → 跳过)，
      // 真实卸载据此去重，保证每个实例 onUnmount 至多一次；热替换不改标记，
      // 真实卸载仍由挂载时的旧 def 成对清理(语义不变)
      const tornDown = tornDownAreas.delete(`${areaId}:${type}`);
      if (def?.onUnmount && el && !tornDown) {
        def.onUnmount({ areaId, contentType: type, el });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, areaId]);
  return (
    <div className="tl-area-content" ref={registerRef}>
      {def ? (
        <AreaBoundary key={type}>
          <def.Comp areaId={areaId} state={raw ?? {}} setState={setState} />
        </AreaBoundary>
      ) : (
        <div className="tl-acontent">
          <b>{getContentTitle(type)}</b>
          <small>通用面板（未注册自定义状态）</small>
        </div>
      )}
    </div>
  );
}
