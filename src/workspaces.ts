import { create } from "zustand";
import { collectSnapshot, migrateSnapshot } from "./layoutData";
import type { LayoutSnapshot } from "./layoutData";
import { useLayout } from "./layoutStore";
import { buildInitialScreen } from "./screen";

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

/** 由布局列表重导出 id 序号(反序列化后调用)：seq 是模块级内存态，页面刷新后
 *  必然回到初值——若不与恢复出的 layout-N 对齐，新建布局会复用已占用的 id，
 *  data 同键覆盖会静默销毁被恢复的布局 */
function syncSeqFromList(list: LayoutInfo[]): void {
  let max = 1;
  for (const it of list) {
    const m = /^layout-(\d+)$/.exec(it.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  seq = max + 1;
}

/** 把当前活跃(总览)状态保存为容器数据(快照 meta 带上布局名) */
function saveInto(): WorkspaceData {
  const ws = useWorkspaces.getState();
  const name = ws.list.find((l) => l.id === ws.activeId)?.name;
  const snap = collectSnapshot(useLayout.getState().screen, name);
  const { past, future } = useLayout.getState();
  return { snapshot: snap, history: { past: [...past], future: [...future] } };
}

export const useWorkspaces = create<WSStore>((set, get) => {
  // 种子布局：从当前屏幕初始化
  const seedId = "layout-1";
  const seedSnapshot = collectSnapshot(useLayout.getState().screen, "General");
  const seed: WorkspaceData = { snapshot: seedSnapshot, history: { past: [], future: [] } };

  return {
    list: [{ id: seedId, name: "General" }],
    data: { [seedId]: seed },
    activeId: seedId,

    create: (name) => {
      // 以当前布局为模板新建：把当前 store 存档给"离开的布局"，并作为新布局的副本(undo 历史清空)
      const st = get();
      let id = `layout-${seq++}`;
      // 兜底防撞：即使 seq 与现存 id 脱节(如绕过 deserialize 的恢复路径)也不覆盖已有布局
      while (st.data[id] || st.list.some((l) => l.id === id)) id = `layout-${seq++}`;
      const curName = st.list.find((l) => l.id === st.activeId)?.name;
      const snap = collectSnapshot(useLayout.getState().screen, curName);
      const cur = useLayout.getState();
      const left: WorkspaceData = { snapshot: snap, history: { past: [...cur.past], future: [...cur.future] } };
      const newLayoutName = name ?? `Layout ${st.list.length + 1}`;
      set({
        list: [...st.list, { id, name: newLayoutName }],
        data: {
          ...st.data,
          [st.activeId]: left,
          [id]: { snapshot: { ...snap, meta: { ...snap.meta, name: newLayoutName } }, history: { past: [], future: [] } },
        },
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

/** 便捷：把所有布局快照导出为 JSON(多布局一起保存/交换)。
 *  与 serializeWorkspaces 对齐：先把活跃布局的实时状态同步进容器，避免导出落后数据。
 * @category 工作区
 */
export function computeAllSnapshots() {
  const st = useWorkspaces.getState();
  const data = { ...st.data, [st.activeId]: saveInto() };
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, JSON.stringify(v.snapshot)]));
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
 *  校验分两级：list 结构非法(整体承重)直接抛错；单个布局容器损坏只剔除该布局
 *  (打警告)并继续——否则 autosave 一次坏写会让整组布局数据不可恢复。
 *  载入同时把 id 序号与恢复的 layout-N 对齐(页面刷新后模块级 seq 会重置)。
 *  @param raw serializeWorkspaces 产出的 JSON 字符串
 *  @throws list 结构缺失/非法或无任何有效布局时抛错(不改动现有工作区状态) */
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

  // 每布局独立校验+归一：快照经 migrateSnapshot，history 缺失/非法归一为空栈。
  // 历史字符串与快照同级校验(软失败)：坏 JSON/非法平铺的条目剔除而非留到
  // 首次 undo 时硬抛——与「单布局损坏只剔除」的容错哲学一致。
  const data: Record<string, WorkspaceData> = {};
  const validHistory = (stack: unknown): string[] => {
    if (!Array.isArray(stack)) return [];
    return stack.filter((x): x is string => {
      if (typeof x !== "string") return false;
      try {
        migrateSnapshot(JSON.parse(x));
        return true;
      } catch {
        return false;
      }
    });
  };
  for (const [k, d] of Object.entries(p.data)) {
    try {
      if (typeof d !== "object" || d === null) throw new Error("容器非法");
      const wd = d as WorkspaceData;
      const snapshot = migrateSnapshot(wd.snapshot);
      const past = validHistory(wd.history?.past);
      const future = validHistory(wd.history?.future);
      data[k] = { snapshot, history: { past, future } };
    } catch (err) {
      console.warn(`[tiling-layout] 工作区「${k}」数据损坏，已跳过:`, err);
    }
  }

  // list/data 一致性：以 list 为准——剔除幽灵条目(list 有 id 无 data)与孤儿容器(有 data 无 list)
  const list = p.list.filter((l) => data[l.id] !== undefined);
  if (!list.length) throw new Error("无有效的工作区数据");
  const kept = Object.fromEntries(list.map((l) => [l.id, data[l.id]]));

  let activeId = p.activeId;
  if (typeof activeId !== "string" || !kept[activeId]) activeId = list[0].id;

  useWorkspaces.setState({ list, data: kept, activeId });
  syncSeqFromList(list);                                              // 新建布局不再复用已恢复的 id
  const target = kept[activeId];
  useLayout.getState().restore(target.snapshot);                      // 几何+实例+共享
  useLayout.setState({ past: target.history.past, future: target.history.future }); // undo 历史
}

/** 快照是否等于「原始默认」状态：areas 等于 buildInitialScreen 三区(按 id 对齐比
 *  几何+类型，排除 meta.savedAt/name)，实例状态为空，共享数据为 {x:0,rot:0}。
 *  直接比 buildInitialScreen 而非 collectSnapshot——后者会读当前全局 store，
 *  用户改过内容后会把默认判定带偏。 */
function isDefaultSnapshot(snap: LayoutSnapshot): boolean {
  const def = buildInitialScreen();
  if (snap.areas.length !== def.areas.length) return false;
  for (const a of def.areas) {
    const b = snap.areas.find((x) => x.id === a.id);
    if (!b || b.contentType !== a.contentType) return false;
    const [xmin, ymin, xmax, ymax] = b.rect; // 快照 rect 为 [xmin,ymin,xmax,ymax] 数组
    if (xmin !== a.rect.xmin || ymin !== a.rect.ymin || xmax !== a.rect.xmax || ymax !== a.rect.ymax) return false;
  }
  if (Object.keys(snap.areaStates ?? {}).length > 0) return false;
  if ((snap.shared?.x ?? 0) !== 0 || (snap.shared?.rot ?? 0) !== 0) return false;
  return true;
}

/** @internal 种子布局(layout-1)仍是「原始默认」时，用给定快照刷新其容器数据。
 *  initialLayout 引导后调用——restore 只改 layoutStore 不刷新 workspaces 容器，
 *  否则切换布局再切回会「变回默认」(种子快照落后于实时 store)。
 *  仅当活跃布局就是种子且种子未被动过时同步，其余情况 no-op。
 *  @param snap 已应用的当前活跃快照 */
export function refreshSeedIfPristine(snap: LayoutSnapshot): void {
  const st = useWorkspaces.getState();
  const seedId = "layout-1";
  const seed = st.data[seedId];
  if (!seed || st.activeId !== seedId) return;
  if (!isDefaultSnapshot(seed.snapshot)) return;
  useWorkspaces.setState({
    data: { ...st.data, [seedId]: { snapshot: snap, history: seed.history } },
  });
}