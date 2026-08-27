import { create } from "zustand";
import { collectSnapshot, migrateSnapshot } from "./layoutData";
import type { LayoutSnapshot } from "./layoutData";
import { useLayout } from "./layoutStore";

/**
 * workspaces — 多布局(工作区)管理。
 *
 * 原则：layoutStore/areaStore/sceneStore 是「当前活跃布局」的暂存视图(可继续被状态机操作)；
 * 这里为每个布局保存一份「完整快照(几何+实例+共享+undo历史)」。切换时 saveActive → restore 目标，
 * 完全复用已验证的状态机，同时保证各布局彼此隔离(互不串数据/历史)。
 * @category 工作区
 */
export interface LayoutInfo { id: string; name: string; }
/** 单个布局的容器数据：完整快照 + undo/redo 历史
 * @category 工作区
 */
export interface WorkspaceData { snapshot: LayoutSnapshot; history: { past: string[]; future: string[] }; }

export interface WSStore {
  list: LayoutInfo[];
  data: Record<string, WorkspaceData>;
  activeId: string;
  create: (name?: string) => string;
  remove: (id?: string) => void;
  switchTo: (id: string) => void;
}

let seq = 2; // 种子布局已占用 layout-1，新建从 layout-2 起

/** 把当前活跃(总览)状态保存为容器数据 */
function saveInto(): WorkspaceData {
  const snap = collectSnapshot(useLayout.getState().screen);
  const { past, future } = useLayout.getState();
  return { snapshot: snap, history: { past: [...past], future: [...future] } };
}

export const useWorkspaces = create<WSStore>((set, get) => {
  // 种子布局：从当前屏幕初始化
  const seedId = "layout-1";
  const seedSnapshot = collectSnapshot(useLayout.getState().screen);
  const seed: WorkspaceData = { snapshot: seedSnapshot, history: { past: [], future: [] } };

  return {
    list: [{ id: seedId, name: "General" }],
    data: { [seedId]: seed },
    activeId: seedId,

    create: (name) => {
      // 以当前布局为模板新建：把当前 store 存档给"离开的布局"，并作为新布局的副本(undo 历史清空)
      const st = get();
      const id = `layout-${seq++}`;
      const snap = collectSnapshot(useLayout.getState().screen);
      const cur = useLayout.getState();
      const left: WorkspaceData = { snapshot: snap, history: { past: [...cur.past], future: [...cur.future] } };
      set({
        list: [...st.list, { id, name: name ?? `Layout ${st.list.length + 1}` }],
        data: { ...st.data, [st.activeId]: left, [id]: { snapshot: snap, history: { past: [], future: [] } } },
        activeId: id,
      });
      // 新建后历史从空白开始(避免串到其它布局)
      useLayout.setState({ past: [], future: [] });
      return id;
    },

    switchTo: (id) => {
      const st = get();
      if (id === st.activeId || !st.data[id]) return;
      // 1) 保存当前活跃到容器
      const saved = saveInto();
      // 2) 恢复目标布局(几何 + 实例 + 共享 + undo 历史)
      const target = st.data[id];
      useLayout.getState().restore(target.snapshot);
      useLayout.setState({ past: target.history.past, future: target.history.future });
      set({ data: { ...st.data, [st.activeId]: saved }, activeId: id });
    },

    remove: (id) => {
      const st = get();
      const rid = id ?? st.activeId;
      if (st.list.length <= 1 || !st.data[rid]) return;
      // 若删除的是当前活跃，先切到首个其它布局(会先保存当前)
      if (rid === st.activeId) {
        const next = st.list.find((l) => l.id !== rid);
        if (!next) return;
        get().switchTo(next.id);
      }
      set((s) => ({
        list: s.list.filter((l) => l.id !== rid),
        data: Object.fromEntries(Object.entries(s.data).filter(([k]) => k !== rid)),
      }));
    },
  };
});

/** 便捷：把所有布局快照导出为 JSON(多布局一起保存/交换)
 * @category 工作区
 */
export function computeAllSnapshots() {
  const st = useWorkspaces.getState();
  return Object.fromEntries(Object.entries(st.data).map(([k, v]) => [k, JSON.stringify(v.snapshot)]));
}

/** localStorage 键名：useLayoutData 自动保存工作区集合的目标
 * @category 工作区
 */
export const WORKSPACES_KEY = "tiling-workspaces-v1";

/** 把整个工作区集合(各布局快照+历史+当前活跃)序列化为 JSON。
 *  会把当前活跃的 store 状态先同步进其容器，保证不落后。
 *  @returns JSON 字符串(可传给 deserializeWorkspaces 载回) */
export function serializeWorkspaces(): string {
  const st = useWorkspaces.getState();
  const data = { ...st.data, [st.activeId]: saveInto() };
  return JSON.stringify({ v: 1, list: st.list, data, activeId: st.activeId });
}

/** 解析并载入整个工作区集合：恢复 list/data/activeId，并把当前活跃布局 restore 进 store(几何+实例+共享+历史)。
 *  输入来自 JSON 反序列化，逐字段校验/归一化：history 缺失补空栈，快照经 migrateSnapshot 校验。
 *  @param raw serializeWorkspaces 产出的 JSON 字符串
 *  @throws 数据缺失/非法时抛错(不改动现有工作区状态) */
export function deserializeWorkspaces(raw: string): void {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) throw new Error("无效的工作区数据");
  const p = parsed as {
    v?: number;
    list: LayoutInfo[];
    data: Record<string, WorkspaceData>;
    activeId: string;
  };
  if (!Array.isArray(p.list) || !p.list.length) throw new Error("无效的工作区数据");
  for (const it of p.list) {
    if (typeof it?.id !== "string" || typeof it?.name !== "string") throw new Error("无效的工作区数据");
  }
  if (typeof p.data !== "object" || p.data === null) throw new Error("无效的工作区数据");
  // 每布局快照做结构校验+归一；history 缺失/非法时归一为空栈
  for (const k of Object.keys(p.data)) {
    const d = p.data[k];
    if (typeof d !== "object" || d === null) throw new Error("无效的工作区数据");
    d.snapshot = migrateSnapshot(d.snapshot);
    const past = Array.isArray(d.history?.past) ? d.history.past.filter((x): x is string => typeof x === "string") : [];
    const future = Array.isArray(d.history?.future) ? d.history.future.filter((x): x is string => typeof x === "string") : [];
    d.history = { past, future };
  }
  if (typeof p.activeId !== "string" || !p.data[p.activeId]) {
    p.activeId = p.list[0].id;
    if (!p.data[p.activeId]) throw new Error("无效的工作区数据");
  }
  useWorkspaces.setState({ list: p.list, data: p.data, activeId: p.activeId });
  const target = p.data[p.activeId];
  useLayout.getState().restore(target.snapshot);                    // 几何+实例+共享
  useLayout.setState({ past: target.history.past, future: target.history.future }); // undo 历史
}