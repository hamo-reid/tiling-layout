import { Component, useCallback, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { hasAreaState, setAreaState, useAreaState } from "./areaStore";
import { getAreaComponent, registerAreaInstance, unregisterAreaInstance } from "./areaInstances";
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
  /** 面板卸载前调用，与 onMount 成对(切换类型/区域被吞并/restore 重建)。
   *  时序保证：同区域切换类型时，旧类型 onUnmount 先于新类型 onMount。 */
  onUnmount?: (ctx: ContentLifecycleCtx) => void;
}

const registry = new Map<string, ContentDef<any>>();

/** 注册一种内容类型。T 由 defaults 与 Comp 的参数共同约束，二者形状必须一致
 *  @param def 内容类型定义(type/title/defaults/Comp/生命周期回调) */
export function registerContent<T extends object>(def: ContentDef<T>): void {
  registry.set(def.type, def as ContentDef<any>);
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
  registry.clear();
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
  const def = registry.get(type) ?? null;
  // 订阅本区域本类型的槽位；其他区域/其他类型的状态变化不触发本组件重渲染
  const raw = useAreaState((s) => s.map[areaId]?.[type]);
  const setState = useCallback(
    (patch: Record<string, unknown>) => setAreaState(areaId, type, patch),
    [areaId, type],
  );
  useLayoutEffect(() => {
    // paint 前注入 defaults：首帧即有完整状态(用户首帧交互不会丢字段)；
    // 该类型槽位已存在时不动(swap/move 迁移过来的实例状态不覆盖)
    if (def?.defaults && !hasAreaState(areaId, type)) setAreaState(areaId, type, def.defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, areaId]);
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
      if (def?.onUnmount && el) def.onUnmount({ areaId, contentType: type, el });
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
