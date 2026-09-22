import { create } from "zustand";
import * as G from "./geometry";
import { runtime } from "./runtimeConfig";
import { buildInitialScreen } from "./screen";
import { getContentTitle } from "./registry";
import { applySnapshot, collectSnapshot, migrateSnapshot } from "./layoutData";
import { beginMutation, landPatch } from "./store/shared";
import { createCornerActions } from "./store/corner";
import { createDockActions } from "./store/dock";
import { createResizeActions } from "./store/resize";
import { createLayoutCommands } from "./store/commands";

/**
 * layoutStore — 全局状态机(组装层)。
 *
 * 手势模式：
 *   - mode 'corner'   : 角标手势。由 ctrl + 落在哪分派
 *                       → split(同区) / join(异区严格) / swap(异区宽松)
 *   - mode 'resizing' : 拖分界线调整大小（连通线族平移、矩形保持）
 *   - mode 'docking'  : 拖区域停靠（5 位热区：中心交换 / 四边分裂停靠）
 *
 * 状态字段 / 快照历史 / 恢复 / 最大化 / 取消 在本文件；三个手势域拆到
 * `store/corner|dock|resize.ts`(工厂函数接收 get/set,经 store/shared 复用辅助)。
 * 由 LayoutViewDom 把 DOM 事件换算成数学坐标(x,y)后调用这些 action；几何用 screen
 * 引用直接 mutate 后浅拷贝顶层触发 React 重渲。
 */

type Vec2 = G.Vec2; // 与几何层共用同一坐标点类型，避免重复定义漂移
/** 停靠目标：center 目标区中央替换 / 四边停靠槽 / none 无有效目标
 * @category 状态机与门面
 */
export type DockTarget = "center" | G.DockSide | "none";
/** 拖拽停靠的手势中间态
 * @category 状态机与门面
 */
export interface DockState {
  srcId: number;
  start: Vec2;
  targetId: number | null;
  target: DockTarget;
  factorDock: number;   // 槽占目标该维的比例
  canClose: boolean;    // 四边停靠是否可行:源区可被"非目标"邻居吞并,或与目标共享整边(并集重排)
}
/** 拖拽分界线改大小的手势中间态
 * @category 状态机与门面
 */
export interface ResizeCtx {
  seg: G.Seg;
  dir: G.Axis;
  orig: number;
  origPt: number;
  /** 线族在**动手之前**解出的夹逼区间、成员表与逐成员可行边界。拖动过程中线已离开
   *  原坐标，再查 `edgeFamilyAreas` 会查不到族，故在此一次性取好、每帧复用。 */
  bounds: G.LineBounds | null;
  /**
   * 须整体平移的矩形族(成员 + 其位于线的哪一侧)。
   *
   * @deprecated 就是 `bounds.family` 的快照 —— 改读 `bounds`，本字段 1.0 前移除。
   *   保留仅为 0.4.0 消费方的读取兼容。
   */
  moved: G.FamilyMember[];
  /**
   * 逐成员的可行边界，与 `moved` 同序；其归约(逐项 max(min) / min(max))即 `bounds.lo`/`bounds.hi`。
   *
   * @deprecated 就是 `bounds.limits` —— `moved`/`adj` 与 `bounds` 同源(都出自
   *   `geometry.lineBounds`)，故不会漂。改读 `bounds`，本字段 1.0 前移除。
   */
  adj: G.MemberLimit[];
  /** 拖拽前快照(undo 用)：endResize 实际发生位移才入栈，取消即丢弃 */
  pre: string;
  /** 拖拽前的矩形引用表(cancel 回滚用)。resizeMove 以 withRect 产物整体替换
   *  area.rect，旧 Rect 对象仍完好——cancel 时按此表原样恢复即回滚几何 */
  origRects: { area: G.Area; rect: G.Rect }[];
  /** 本次手势是否实际发生位移(决定 endResize 是否入历史栈) */
  dragged: boolean;
}

/** 命令结果：纯数据，不外泄 Area/Rect 引用(调用方据此写状态栏与错误信息，无需反查 screen) */
export interface SplitResult { readonly kept: number; readonly created: number }
export interface CloseResult {
  readonly closed: number;
  readonly side: G.CloseSide;
  /** 邻居多于一个(分摊扩张) */
  readonly spanned: boolean;
  /** 吞并它的区域 id 列表 */
  readonly absorbedBy: readonly number[];
}
export interface MergeResult { readonly keep: number; readonly dropped: number; readonly droppedContent: string }
export interface SwapResult { readonly a: number; readonly b: number }
export interface RatioResult { readonly from: number; readonly to: number; readonly axis: G.Axis; readonly members: number }
export interface CloseOptions {
  /** 只接受这一侧(启发式之外的强制口)；不给则按 planClose 的偏好选边 */
  readonly side?: G.CloseSide;
  /** 不可作为吞并方的区域 id */
  readonly exclude?: readonly number[];
}

/** 全局布局状态机：状态字段(供渲染层订阅显示) + action(由 UI 事件换算坐标后调用)
 * @category 状态机与门面
 */
export interface LayoutStore {
  /** 当前屏幕几何(引用语义：浅拷贝顶层触发重渲) */
  screen: G.Screen;
  /** 状态机模式：idle 常态 / corner 角标手势 / resizing 拖分界线 / docking 拖拽停靠 */
  mode: "idle" | "corner" | "resizing" | "docking";
  /** 底部状态栏文字 */
  status: string;

  // corner / split 预览
  /** 角标手势起点(数学坐标) */
  cornerStart: Vec2;
  /** 最近一次指针位置(数学坐标)：toggleSplitDir 换向后重算分割线用 */
  lastPt: Vec2;
  /** 手势源区域 id(null=无手势) */
  srcId: number | null;
  /** 角标 hover 高亮的目标区域 id */
  hoverTId: number | null;
  /** 预览分割方向(null=无分割预览) */
  splitDir: G.Axis | null;
  /** 预览分割线坐标 */
  splitLine: number;
  /** 分割线是否处于吸附状态 */
  snapped: boolean;
  /** ctrl 键当前按下状态(决定角标手势分派) */
  ctrl: boolean;

  /** 拖拽分界线中间态(null=非 resizing) */
  resize: ResizeCtx | null;
  /** 拖拽停靠中间态(null=非 docking) */
  dock: DockState | null;

  // 区域最大化：渲染层视图状态(不改几何/快照；恢复/切换布局时清空)
  /** 最大化显示的区域 id(null=无) */
  maximizedId: number | null;

  // 数据层：历史栈(快照) + 恢复
  /** undo 历史(JSON 快照字符串栈) */
  past: string[];
  /** redo 历史 */
  future: string[];
  /** 把当前屏幕压入 undo 栈并清空 redo 栈 */
  commitHistory: () => void;
  /** 撤销上一步(恢复 past 栈顶快照) */
  undo: () => void;
  /** 重做(恢复 future 栈顶快照) */
  redo: () => void;
  /** 恢复任意来源的快照数据(JSON.parse 结果均可)：内部经 migrateSnapshot
   *  结构校验+归一，几何非法直接抛错。
   *  @param snap 快照数据(JSON.parse 结果) */
  restore: (snap: unknown) => void;

  /** 程序化切换区域内容：进历史栈、不可变更新 contentType；实例状态由双键分槽自动隔离
   *  @param areaId 目标区域 id
   *  @param type 新内容类型标识 */
  setAreaContent: (areaId: number, type: string) => void;

  // ── 命令式排布(收 id、返回纯数据、幂等) ──────────────────────────────
  /** 沿 dir 一分为二：源区保 min 侧占 ratio(缺省 0.5)，新块继承源区内容与实例状态。
   *  区域不存在 / 不足以分割 / 结果不合法 → null(零改动)。 */
  splitArea: (id: number, dir: G.Axis, ratio?: number) => SplitResult | null;
  /** 关闭区域并把它的位置并入紧邻者(邻居分摊扩张)。只剩一块 / 无解 / 结果不合法 → null。 */
  closeArea: (id: number, opts?: CloseOptions) => CloseResult | null;
  /** 合并两块：**保留 keep 的内容，丢弃 remove 的**。不共享整条分界线 / 结果不合法 → null。 */
  mergeAreas: (keepId: number, removeId: number) => MergeResult | null;
  /** 交换两块显示的内容(含实例状态)，几何不动。 */
  swapAreas: (a: number, b: number) => SwapResult | null;
  /** 把整条连通线族平移到「a 侧占 ratio」的位置(与手动拖分界线同语义)。 */
  setRatio: (seg: G.Seg, ratio: number) => RatioResult | null;
  /** 幂等设置最大化目标(null = 退出)。**不进历史**(视图态)。 */
  setMaximized: (id: number | null) => void;

  /** 设置状态栏文字 @param t 状态文字 */
  setStatus: (t: string) => void;
  /** 设置 ctrl 按键状态 @param v 是否按下 */
  setCtrl: (v: boolean) => void;
  /** 切换当前预览分割方向(H↔V) */
  toggleSplitDir: () => void;
  /** 切换区域最大化 @param areaId 目标区域 id */
  toggleMaximize: (areaId: number) => void;
  /** 退出最大化 */
  exitMaximize: () => void;
  /** 开始角标手势(分割/合并/交换) @param areaId 角标所在区域 @param start 起点数学坐标 @param ctrl ctrl 是否按下 */
  beginCorner: (areaId: number, start: Vec2, ctrl: boolean) => void;
  /** 角标手势移动(更新预览) @param x 指针 x @param y 指针 y */
  cornerMove: (x: number, y: number) => void;
  /** 角标手势结束(执行分割/合并/交换) */
  cornerUp: () => void;
  /** 开始拖拽分界线 @param seg 命中的推导线段 @param m 指针起点(数学坐标) */
  beginResize: (seg: G.Seg, m: Vec2) => void;
  /** 拖拽分界线移动(连通边族平移) @param x 指针 x @param y 指针 y */
  resizeMove: (x: number, y: number) => void;
  /** 结束拖拽分界线 */
  endResize: () => void;
  /** 开始拖拽停靠 @param areaId 抓取的区域 id @param start 指针起点(数学坐标) */
  beginDock: (areaId: number, start: Vec2) => void;
  /** 拖拽停靠移动(更新目标预览) @param x 指针 x @param y 指针 y */
  dockMove: (x: number, y: number) => void;
  /** 拖拽停靠结束(执行停靠落位) */
  dockUp: () => void;
  /** 取消当前手势(idle 且清预览)；resizing 已改写的几何一并回滚，不落任何改动 */
  cancel: () => void;
}

/** 全局布局状态机 store：订阅交互态/快照历史，派发手势 action(成员见 LayoutStore)。
 *  @category 状态机与门面
 */
export const useLayout = create<LayoutStore>((set, get) => ({
  screen: buildInitialScreen(),
  mode: "idle",
  status: "",
  cornerStart: { x: 0, y: 0 },
  lastPt: { x: 0, y: 0 },
  srcId: null,
  hoverTId: null,
  splitDir: null,
  splitLine: 0,
  snapped: false,
  ctrl: false,
  resize: null,
  dock: null,
  maximizedId: null,
  past: [],
  future: [],

  commitHistory: () => {
    const past = [...get().past, JSON.stringify(collectSnapshot(get().screen))].slice(-runtime().historyMax);
    set({ past, future: [] });
  },
  restore: (snap) => {
    const normalized = migrateSnapshot(snap);      // 结构校验+归一
    const s = applySnapshot(normalized);            // 重建 screen + 同步 areaStore/sceneStore
    // 清空全部手势残留：restore 可能发生在任意时刻(切换/undo/导入)，
    // 残留的 resize/dock 上下文持有已失效的 Area 引用，继续手势会写坏新布局
    set({
      screen: { ...s },
      mode: "idle",
      maximizedId: null,
      srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false,
      resize: null, dock: null,
    });
  },

  setAreaContent: (areaId, type) => {
    const st = get();
    const s = st.screen;
    const a = s.areas.find((x) => x.id === areaId);
    if (!a || a.contentType === type) return;     // 区域不存在 / 类型未变 → no-op，不进历史栈
    const pre = beginMutation(s);                  // 先打快照 → undo 一步回到切换前
    set(landPatch(st, {
      screen: s,
      retype: new Map([[areaId, type]]),
      status: `已切换为「${getContentTitle(type)}」`,
      pre,
      mutated: true,
    }));                                           // layoutBus 经 store 订阅+指纹自动感知
  },
  undo: () => {
    const st = get();
    if (!st.past.length) return;
    const future = [...st.future, JSON.stringify(collectSnapshot(st.screen))];
    st.restore(JSON.parse(st.past[st.past.length - 1]));
    set({ past: st.past.slice(0, -1), future, mode: "idle" });
  },
  redo: () => {
    const st = get();
    if (!st.future.length) return;
    const past = [...st.past, JSON.stringify(collectSnapshot(st.screen))];
    st.restore(JSON.parse(st.future[st.future.length - 1]));
    set({ past, future: st.future.slice(0, -1), mode: "idle" });
  },

  setStatus: (status) => set({ status }),
  setCtrl: (ctrl) => set({ ctrl }),

  toggleMaximize: (areaId) => {
    // 手势要的"再点一次切回来"；幂等设置走 setMaximized（唯一实现）
    get().setMaximized(get().maximizedId === areaId ? null : areaId);
  },
  exitMaximize: () => {
    get().setMaximized(null);
  },

  // 命令式排布(收 id、返回纯数据、单点入栈)与三个手势域(角标 / 停靠 / 分界线)
  // 由各自模块的工厂装配，共享 get/set 与 store/shared 辅助
  ...createLayoutCommands(get, set),
  ...createCornerActions(get, set),
  ...createDockActions(get, set),
  ...createResizeActions(get, set),

  cancel: () => {
    const st = get();
    const s = st.screen;
    const r = st.resize;
    // resizing 的几何已被 resizeMove 原地改写：按拖拽前矩形引用表回滚，「已取消」名副其实
    if (r) {
      for (const { area, rect: rc } of r.origRects) area.rect = rc;
    }
    set({
      mode: "idle",
      status: "已取消",
      srcId: null,
      hoverTId: null,
      splitDir: null,
      snapped: false,
      resize: null,
      dock: null,
      screen: { ...s },
    });
  },
}));
