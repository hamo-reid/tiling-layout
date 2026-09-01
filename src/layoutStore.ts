import { create } from "zustand";
import * as G from "./geometry";
import { buildInitialScreen } from "./screen";
import { cloneAreaState, moveAreaState, removeAreaStates, swapAreaState } from "./areaStore";
import { getContentTitle } from "./registry";
import { applySnapshot, collectSnapshot, migrateSnapshot } from "./layoutData";

/**
 * layoutStore — 全局状态机。
 *
 * 手势模式：
 *   - mode 'corner'   : 角标手势。由 ctrl + 落在哪分派
 *                       → split(同区) / join(异区严格) / swap(异区宽松)
 *   - mode 'resizing' : 拖分界线调整大小（连通线族平移、矩形保持）
 *   - mode 'docking'  : 拖区域停靠（5 位热区：中心交换 / 四边分裂停靠）
 *
 * 由 LayoutViewDom 把 DOM 事件换算成数学坐标(x,y)后调用这些 action；几何用 screen 引用
 * 直接 mutate 后浅拷贝顶层触发 React 重渲。
 */

type Vec2 = G.Vec2; // 与几何层共用同一坐标点类型，避免重复定义漂移
/** 停靠目标：center 目标区中央替换 / 四边停靠槽 / none 无有效目标
 * @category 状态机与门面
 */
export type DockTarget = "center" | "left" | "right" | "top" | "bottom" | "none";
/** 拖拽停靠的手势中间态
 * @category 状态机与门面
 */
export interface DockState {
  srcId: number;
  start: Vec2;
  targetId: number | null;
  target: DockTarget;
  factorDock: number;   // 槽占目标该维的比例
  canClose: boolean;    // 源区能否被邻居吞并闭合(否则四边停靠不可行)
}
/** 拖拽分界线改大小的手势中间态
 * @category 状态机与门面
 */
export interface ResizeCtx {
  seg: G.Seg;
  dir: G.Axis;
  orig: number;
  origPt: number;
  /** 须整体平移的矩形族(成员 + 其位于线的哪一侧) */
  moved: G.FamilyMember[];
  adj: { min?: number; max?: number }[];
  /** 拖拽前快照(undo 用)：endResize 实际发生位移才入栈，取消即丢弃 */
  pre: string;
  /** 拖拽前的矩形引用表(cancel 回滚用)。resizeMove 以 withRect 产物整体替换
   *  area.rect，旧 Rect 对象仍完好——cancel 时按此表原样恢复即回滚几何 */
  origRects: { area: G.Area; rect: G.Rect }[];
  /** 本次手势是否实际发生位移(决定 endResize 是否入历史栈) */
  dragged: boolean;
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

const name = (t: string | undefined) => getContentTitle(t ?? "general");

/** 历史栈上限(条数) */
const HISTORY_MAX = 60;

/** 内容类型变化不可变落地：按 (areaId → contentType) 生成新 Area 对象，原对象引用不变，
 *  细粒度 selector(按 contentType/对象引用订阅)不会漏更新。split/join 等几何变异不受影响。 */
function retypedAreas(s: G.Screen, changes: Map<number, string>): G.Area[] {
  if (!changes.size) return s.areas;
  return s.areas.map((a) => {
    const t = changes.get(a.id);
    return t === undefined || t === a.contentType ? a : { ...a, contentType: t };
  });
}

/** 停靠槽占比吸附：靠近 1/2 → 1/2，否则对齐到常用分格 */
function snapFactor(v: number): number {
  const grid = [0.25, 0.33, 0.5, 0.66, 0.75];
  let best = grid[0], bd = Math.abs(v - best);
  for (const t of grid) { const d = Math.abs(v - t); if (d < bd) { bd = d; best = t; } }
  return best;
}
function sideLabel(t: DockTarget): string {
  return t === "left" ? "左侧" : t === "right" ? "右侧" : t === "top" ? "上方" : "下方";
}

/** 全局布局状态机 store：订阅交互态/快照历史，派发手势 action(成员见 LayoutStore)。
 *  @category 状态机与门面
 */
export const useLayout = create<LayoutStore>((set, get) => {
  const areaById = (id: number | null) => id == null ? null : get().screen.areas.find((a) => a.id === id) ?? null;

  /** 由 splitLine 反算 factor(0..1)，供 split() 用 */
  const factorFromLine = (src: G.Area, dir: G.Axis, line: number): number => {
    const r = G.areaRect(get().screen, src);
    const base = dir === G.AXIS.H ? r.ymin : r.xmin;
    const size = dir === G.AXIS.H ? r.height : r.width;
    return Math.max(0, Math.min(1, (line - base) / size));
  };

  return {
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
      const past = [...get().past, JSON.stringify(collectSnapshot(get().screen))].slice(-HISTORY_MAX);
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
      const s = get().screen;
      const a = s.areas.find((x) => x.id === areaId);
      if (!a || a.contentType === type) return;     // 区域不存在 / 类型未变 → no-op，不进历史栈
      get().commitHistory();                         // 先打快照 → undo 一步回到切换前
      set({
        screen: { ...s, areas: retypedAreas(s, new Map([[areaId, type]])) },
        status: `已切换为「${getContentTitle(type)}」`,
      });                                            // layoutBus 经 store 订阅+指纹自动感知
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

    toggleSplitDir: () => {
      const st = get();
      // 仅角标手势中有效(idle/docking/resizing 下 Tab 交还宿主页面，不劫持键盘导航)
      if (st.mode !== "corner" || st.hoverTId != null || !st.splitDir || st.srcId == null) return;
      const src = areaById(st.srcId);
      if (!src) return;
      const nd = st.splitDir === G.AXIS.H ? G.AXIS.V : G.AXIS.H;
      // 换向必须重算分割线：splitLine 语义随轴变化(x↔y)，沿用旧值会让
      // cornerUp 用错轴的坐标落刀(factorFromLine 会拿 x 值当 y 比例解读)
      const r = G.areaRect(st.screen, src);
      let line = nd === G.AXIS.H
        ? Math.max(r.ymin, Math.min(r.ymax, st.lastPt.y))
        : Math.max(r.xmin, Math.min(r.xmax, st.lastPt.x));
      let snapped = false;
      if (st.ctrl) {
        const base = nd === G.AXIS.H ? r.ymin : r.xmin;
        const size = nd === G.AXIS.H ? r.height : r.width;
        const snap = G.snapCoord(st.screen, src, line - base, base, nd, size, 0);
        if (snap !== null) { line = snap; snapped = true; }
      }
      set({ splitDir: nd, splitLine: line, snapped });
    },

    toggleMaximize: (areaId) => {
      const st = get();
      const maximizedId = st.maximizedId === areaId ? null : areaId;
      set({ maximizedId, mode: "idle", srcId: null, hoverTId: null, splitDir: null, snapped: false, resize: null, dock: null });
    },
    exitMaximize: () => {
      set({ maximizedId: null, mode: "idle", srcId: null, hoverTId: null, splitDir: null, snapped: false, resize: null, dock: null });
    },

    beginCorner: (_areaId, start, ctrl) => {
      // 角点不绑定单一区域：拖向哪块就在拖拽中动态确定
      const s = get().screen;
      set({
        mode: "corner",
        srcId: null,
        cornerStart: start,
        lastPt: start,
        ctrl,
        hoverTId: null,
        splitDir: null,
        splitLine: 0,
        snapped: false,
        screen: { ...s },
      });
    },

    cornerMove: (x, y) => {
      const st = get();
      const s = st.screen;
      // ★ 动态锁定操作对象：鼠标拖入的第一个区域。
      //   必须先拖离角锚点一段距离再锁定——角点位于共享边界上(多区域重叠命中)，
      //   过早锁定会错定位；等价于按初始移出方向分片。
      let src = areaById(st.srcId);
      if (!src) {
        if (Math.hypot(x - st.cornerStart.x, y - st.cornerStart.y) < 0.01) return;
        const first = G.findAreaAtXY(s, x, y);
        if (!first) return;
        src = first;
        set({ srcId: first.id });
      }
      set({ lastPt: { x, y } });   // 记录最新指针位置(toggleSplitDir 换向重算分割线用)
      const cur = G.findAreaAtXY(s, x, y);
      const inSrc = cur === src;
      const strict = cur && !inSrc && G.findSharedEdge(s, src, cur);
      const loose = cur && !inSrc && G.isBoundaryAdjacent(s, src, cur);
      const valid = st.ctrl ? loose : strict;

      if (valid) {
        set({ hoverTId: cur!.id, splitDir: null, screen: { ...s } });
        return;
      }

      // split 路径：仍在源区(或空白)，或不可用的异区
      set({ hoverTId: null });
      if (!inSrc && cur) { set({ splitDir: null }); return; } // 撞到不可合并的区域 → 无手势

      let dir = st.splitDir;
      if (!dir) {
        const dx = x - st.cornerStart.x, dy = y - st.cornerStart.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.005) {
          dir = Math.abs(dx) > Math.abs(dy) ? G.AXIS.V : G.AXIS.H;
        }
      }
      if (!dir) { set({ splitDir: null }); return; }

      const r = G.areaRect(s, src);
      let line = dir === G.AXIS.H
        ? Math.max(r.ymin, Math.min(r.ymax, y))
        : Math.max(r.xmin, Math.min(r.xmax, x));
      let snapped = false;
      if (st.ctrl && dir) {
        const base = dir === G.AXIS.H ? r.ymin : r.xmin;
        const size = dir === G.AXIS.H ? r.height : r.width;
        const snap = G.snapCoord(s, src, line - base, base, dir, size, 0);
        if (snap !== null) { line = snap; snapped = true; }
      }
      set({ splitDir: dir, splitLine: line, snapped, screen: { ...s } });
    },

    cornerUp: () => {
      const st = get();
      const s = st.screen;
      const pre = JSON.stringify(collectSnapshot(s)); // 操作前快照(实际生效才入栈)
      const src = areaById(st.srcId);
      const tgt = areaById(st.hoverTId);
      let status: string;
      const retype = new Map<number, string>(); // 内容类型变化(不可变落地)
      let mutated = false;                       // 几何/内容实际变化才入历史(纯取消不污染 undo)

      if (src && tgt && tgt !== src) {
        if (st.ctrl) {
          // 内容交换：contentType 互换 + 实例状态随同互换
          const srcT = src.contentType, tgtT = tgt.contentType;
          swapAreaState(src.id, tgt.id);
          retype.set(src.id, tgtT).set(tgt.id, srcT);
          status = `已交换「${name(srcT)}」与「${name(tgtT)}」内容。`;
          mutated = true;
        } else {
          const keep = G.joinAreas(s, src, tgt); // 保留角落源区，吸收目标
          if (keep) {
            removeAreaStates([tgt.id]);          // 被吞块实例状态随内容丢弃
            status = `已合并 → 「${name(keep.contentType)}」`;
            mutated = true;
          } else {
            status = "无法合并：两区域需共享整条分界线。";
          }
        }
      } else if (st.splitDir && src) {
        const fac = factorFromLine(src, st.splitDir, st.splitLine);
        const narea = G.split(s, src, st.splitDir, fac);
        if (narea) {
          cloneAreaState(src.id, narea.id); // 新生区域继承来源实例状态(clone)
          mutated = true;
        }
        status = narea
          ? `已分割「${name(src.contentType)}」→ 新区域「${name(narea.contentType)}」。新分界线可继续拖动。`
          : "当前区域过小，无法分割。";
      } else {
        status = "已取消";
      }

      set({
        mode: "idle",
        status,
        srcId: null,
        hoverTId: null,
        splitDir: null,
        snapped: false,
        past: mutated ? [...st.past, pre].slice(-HISTORY_MAX) : st.past,
        future: mutated ? [] : st.future,
        screen: { ...s, areas: retypedAreas(s, retype) },
      });
    },

    beginDock: (areaId, start) => {
      const s = get().screen;
      set({
        mode: "docking",
        dock: { srcId: areaId, start, targetId: null, target: "none", factorDock: 0.4, canClose: false },
        status: "拖动区域到另一区域停靠 — 中心:交换 / 四边:分裂停靠 · Esc/右键 取消",
        // 清角标手势残留(标签页切换手势/嵌套按下时防止脏状态串场)
        srcId: null, hoverTId: null, splitDir: null, snapped: false,
        screen: { ...s },
      });
    },

    dockMove: (x, y) => {
      const st = get();
      const dk = st.dock;
      if (!dk) return;
      const s = st.screen;
      const src = areaById(dk.srcId);
      if (!src) { set({ dock: null }); return; }
      const cur = G.findAreaAtXY(s, x, y);
      if (!cur || cur.id === dk.srcId) {
        set({ dock: { ...dk, targetId: null, target: "none" } });
        return;
      }
      const r = G.areaRect(s, cur);
      const fx = (x - r.xmin) / r.width;
      const fy = (y - r.ymin) / r.height;
      // 5 位停靠热区
      let target: DockTarget;
      if (fx >= 0.25 && fx <= 0.75 && fy >= 0.25 && fy <= 0.75) {
        target = "center";
      } else {
        const m = Math.min(fx, 1 - fx, fy, 1 - fy);
        target = m === (1 - fy) ? "top" : m === fy ? "bottom" : m === fx ? "left" : "right";
      }
      // 槽占比 + 吸附(简化)
      const raw = target === "left" ? fx
        : target === "right" ? 1 - fx
        : target === "bottom" ? fy
        : target === "top" ? 1 - fy
        : 0.4;
      const factorDock = target === "center" ? 0.4 : snapFactor(raw);
      // 源区能否被邻居吞并闭合(否则四边停靠不可行)
      const canClose = target === "center" || s.areas.some((nb) => nb !== cur && G.findSharedEdge(s, src, nb));
      const finalTarget: DockTarget = canClose ? target : "none";
      set({ dock: { ...dk, targetId: cur.id, target: finalTarget, factorDock, canClose } });
    },

    dockUp: () => {
      const st = get();
      const s = st.screen;
      const pre = JSON.stringify(collectSnapshot(s)); // 操作前快照(实际生效才入栈)
      const dk = st.dock;
      let status: string;
      const retype = new Map<number, string>(); // 内容类型变化(不可变落地)
      let mutated = false;                       // 几何/内容实际变化才入历史
      if (dk) {
        const src = areaById(dk.srcId);
        const tgt = areaById(dk.targetId);
        if (!src || !tgt || tgt.id === dk.srcId || dk.target === "none") {
          status = "已取消";
        } else if (dk.target === "center") {
          // 中心停靠=交换内容（Area 对象不可变替换）
          const srcT = src.contentType, tgtT = tgt.contentType;
          swapAreaState(src.id, tgt.id);
          retype.set(src.id, tgtT).set(tgt.id, srcT);
          status = `已交换「${name(srcT)}」与「${name(tgtT)}」内容。`;
          mutated = true;
        } else {
          // 四边停靠：目标内分裂出槽承载拖区内容；源区由邻居吞并闭合
          const axis = (dk.target === "left" || dk.target === "right") ? G.AXIS.V : G.AXIS.H;
          const param = (dk.target === "left" || dk.target === "bottom") ? dk.factorDock : 1 - dk.factorDock;
          const slot = G.split(s, tgt, axis, param);
          if (!slot) {
            status = "目标区域过小，无法停靠。";
          } else {
            const oldType = src.contentType;
            const ar = G.areaRect(s, tgt), br = G.areaRect(s, slot);
            // 识别停靠侧 = 槽；非槽保留目标原内容
            const left = ar.xmin < br.xmin ? tgt : slot;
            const bottom = ar.ymin < br.ymin ? tgt : slot;
            const dockSide = dk.target === "left" ? left
              : dk.target === "right" ? (left === tgt ? slot : tgt)
              : dk.target === "bottom" ? bottom
              : (bottom === tgt ? slot : tgt); // top
            const other = dockSide === tgt ? slot : tgt;
            // 拖区内容进槽(dockSide)；非槽侧(other)内容本就不变 → 无需赋值。
            // retype 落地放在闭合成功分支，回滚路径不触碰任何 contentType。

            // 移除源区：找共享整条边的邻居吞并(闭合)
            let closed = false;
            for (const nb of s.areas) {
              if (nb === dockSide || nb === other) continue;
              if (G.findSharedEdge(s, src, nb) && G.joinAreas(s, nb, src)) { closed = true; break; }
            }
            if (!closed) {
              G.joinAreas(s, tgt, slot); // 回滚：槽并回目标，源区不动
              status = "无法闭合源区位置，已取消停靠。";
            } else {
              retype.set(dockSide.id, oldType); // 拖区内容进槽
              moveAreaState(src.id, dockSide.id); // 源内容进槽：实例状态随之转移到槽
              status = `已停靠「${name(oldType)}」到目标${sideLabel(dk.target)}。`;
              mutated = true;
            }
          }
        }
      } else {
        status = "已取消";
      }
      set({
        mode: "idle",
        status,
        dock: null,
        past: mutated ? [...st.past, pre].slice(-HISTORY_MAX) : st.past,
        future: mutated ? [] : st.future,
        screen: { ...s, areas: retypedAreas(s, retype) },
      });
    },

    beginResize: (seg, m) => {
      const s = get().screen;
      const dir: G.Axis = seg.v1.x === seg.v2.x ? G.AXIS.V : G.AXIS.H;
      const orig = dir === G.AXIS.V ? seg.v1.x : seg.v1.y;
      const moved = G.edgeFamilyAreas(s, seg);
      // 夹逼约束必须覆盖线族「全部」成员：min 侧矩形(内边触线)约束线不可越过
      // 自身近边+MIN，max 侧对称。只看与命中段区间完全贴齐的成员会漏掉横跨
      // 整线的对侧矩形(如全高区域)——把它拖破 MIN 甚至负宽(几何反转)。
      const adj: { min?: number; max?: number }[] = [];
      for (const { area, side } of moved) {
        const r = area.rect;
        if (side === "min") {
          adj.push(dir === G.AXIS.V ? { min: r.xmin + G.MIN_AREA_W } : { min: r.ymin + G.MIN_AREA_H });
        } else {
          adj.push(dir === G.AXIS.V ? { max: r.xmax - G.MIN_AREA_W } : { max: r.ymax - G.MIN_AREA_H });
        }
      }
      set({
        mode: "resizing",
        resize: {
          seg,
          dir,
          orig,
          origPt: dir === G.AXIS.V ? m.x : m.y,
          moved,
          adj,
          pre: JSON.stringify(collectSnapshot(s)),   // 拖拽前快照：endResize 实际位移才入栈
          origRects: moved.map(({ area }) => ({ area, rect: area.rect })), // cancel 回滚依据
          dragged: false,
        },
        status: "调整大小中 — Esc / 右键 取消",
        // 清角标手势残留(防止脏状态串场)
        srcId: null, hoverTId: null, splitDir: null, snapped: false,
        screen: { ...s },
      });
    },

    resizeMove: (x, y) => {
      const st = get();
      const r = st.resize;
      if (!r) return;
      const s = st.screen;
      const curAxis = r.dir === G.AXIS.V ? x : y;
      if (!Number.isFinite(curAxis)) return;   // 程序化调用兜底(DOM 桥已保证有限值)
      let newV = r.orig + (curAxis - r.origPt);
      let lo = -Infinity, hi = Infinity;
      for (const c of r.adj) {
        if (c.min !== undefined) lo = Math.max(lo, c.min);
        if (c.max !== undefined) hi = Math.min(hi, c.max);
      }
      newV = Math.max(lo, Math.min(hi, newV));
      // 仅「从未位移」时跳过写入(避免引用抖动)；已位移后指针精确回到起点也必须
      // 写回 orig——否则几何停在最后一次位移位置，与指针目视位置不符
      if (newV === r.orig && !r.dragged) return;
      r.dragged = true;
      for (const { area, side } of r.moved) {
        // min 侧矩形以内边(xmax/ymax)触线，max 侧以 xmin/ymin 触线；一律走 withRect 保持派生字段
        area.rect = side === "min"
          ? G.withRect(area.rect, r.dir === G.AXIS.V ? { xmax: newV } : { ymax: newV })
          : G.withRect(area.rect, r.dir === G.AXIS.V ? { xmin: newV } : { ymin: newV });
      }
      set({ screen: { ...s } });
    },

    endResize: () => {
      const st = get();
      const r = st.resize;
      const s = st.screen;
      // 实际发生位移才入历史栈(压入拖拽前快照)；纯点击分界线不产生 undo 条目
      const dragged = r?.dragged ?? false;
      set({
        mode: "idle",
        resize: null,
        status: "就绪",
        past: dragged ? [...st.past, r!.pre].slice(-HISTORY_MAX) : st.past,
        future: dragged ? [] : st.future,
        screen: { ...s },
      });
    },

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
  };
});