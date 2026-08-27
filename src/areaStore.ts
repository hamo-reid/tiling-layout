import { create } from "zustand";

/**
 * areaStore — 每个区域(area)承载组件的独立实例状态，按「区域 × 内容类型」双键分槽。
 *
 * 把组件状态提升到这块外部 store，而维度组件只负责按 id 桥接读写 → 状态脱离
 * React 生命周期，split/join/swap/dock 重塑 DOM 时用「迁移」保持连续。
 * map[areaId][contentType] = 该位置"如果显示某类型面板"时那个面板的状态：
 * 切换 contentType 只是换显示对象，各类型槽位原地保留，切回即恢复。
 *
 * 写入必须走本模块的函数（不可变替换内层槽位对象）——cloneAreaState 对外层
 * 浅拷贝，任何原地修改内层对象的写法都会与克隆出的区域串写。
 */

/** 每区域实例状态：由承载组件决定结构(默认空对象)
 * @category 实例状态
 */
export type AreaState = Record<string, unknown>;
/** 单个区域的全部类型槽位：contentType → 该类型面板的实例状态
 * @category 实例状态
 */
export type AreaSlots = Record<string, AreaState>;

export interface AreaStateStore {
  map: Record<number, AreaSlots>;
}

export const useAreaState = create<AreaStateStore>(() => ({ map: {} }));

/** 读(纯取，非 hook)：该区域该类型的实例状态；无条目返回空对象
 *  @param id 区域 id
 *  @param type 内容类型标识
 *  @returns 实例状态(可能为空对象) */
export function getAreaState(id: number, type: string): AreaState {
  return useAreaState.getState().map[id]?.[type] ?? {};
}
/** 该区域该类型是否已有状态槽位(与 getAreaState 不同：空对象也算"有")
 *  @param id 区域 id
 *  @param type 内容类型标识 */
export function hasAreaState(id: number, type: string): boolean {
  return type in (useAreaState.getState().map[id] ?? {});
}
/** 增量写（槽位首次写入自动创建）
 *  @param id 区域 id
 *  @param type 内容类型标识
 *  @param patch 增量合并进槽位的状态字段 */
export function setAreaState(id: number, type: string, patch: AreaState): void {
  useAreaState.setState((s) => {
    const slots = { ...(s.map[id] ?? {}) };
    slots[type] = { ...(slots[type] ?? {}), ...patch };
    return { map: { ...s.map, [id]: slots } };
  });
}

/* ---------------- 迁移——随网格操作保持内容实例连续 ----------------
 * 以下操作作用于外层条目(全部类型槽位随内容整体迁移)，不做类型级拆分。 */

/** 克隆：split 新生区域的实例状态继承来源区(浅拷贝外层，内层槽位靠写入侧不可变保证隔离)
 *  @param from 来源区域 id
 *  @param to 目标区域 id
 * @category 实例状态
 */
export function cloneAreaState(from: number, to: number): void {
  useAreaState.setState((s) => {
    const map = { ...s.map };
    map[to] = { ...(map[from] ?? {}) };
    return { map };
  });
}
/** 交换：swap 内容(或 dock center)时两实例状态随之互换
 *  @param a 区域 id 一
 *  @param b 区域 id 二 */
export function swapAreaState(a: number, b: number): void {
  useAreaState.setState((s) => {
    const map = { ...s.map };
    const ta = map[a], tb = map[b];
    map[a] = tb ?? {};
    map[b] = ta ?? {};
    return { map };
  });
}
/** 搬移：dock 四边时源内容进槽，状态转移到槽并删除源
 *  @param from 来源区域 id
 *  @param to 目标区域 id */
export function moveAreaState(from: number, to: number): void {
  useAreaState.setState((s) => {
    const map = { ...s.map };
    const v = map[from] ?? {};
    map[to] = { ...v };
    delete map[from];
    return { map };
  });
}
/** 移除：join 被吞块 / 被删区域丢弃其实例状态
 *  @param ids 要移除状态的区域 id 列表 */
export function removeAreaStates(ids: number[]): void {
  useAreaState.setState((s) => {
    const map = { ...s.map };
    for (const id of ids) delete map[id];
    return { map };
  });
}

/* ---------------- React hook：按 (areaId, type) 桥接某个面板的实例状态 ---------------- */
/** 订阅并读写某区域某类型的实例状态(细粒度订阅，其他区域/类型变化不触发重渲染)
 *  @param id 区域 id(未挂载时传 undefined，value 为空对象且 set 为 no-op)
 *  @param type 内容类型标识
 *  @returns `{ value, set }`：当前实例状态与增量写入函数
 * @category 实例状态
 */
export function useAreaInstance(id: number | undefined, type: string) {
  const value = useAreaState((s) => (id == null ? undefined : s.map[id]?.[type]));
  return {
    value: (value ?? {}) as AreaState,
    set: (patch: AreaState) => { if (id != null) setAreaState(id, type, patch); },
  };
}
