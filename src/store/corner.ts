/**
 * store/corner.ts — 角标手势(分割 / 合并 / 交换)与分割方向切换。
 *
 * 由 layoutStore 组装进 store;状态经 get/set 读写,辅助走 store/shared。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { cloneAreaState, removeAreaStates, swapAreaState } from "../areaStore";
import { collectSnapshot } from "../layoutData";
import type { LayoutStore } from "../layoutStore";
import { areaById, contentName, factorFromLine, retypedAreas } from "./shared";

type Get = () => LayoutStore;
type Set = (partial: Partial<LayoutStore>) => void;

export function createCornerActions(
  get: Get,
  set: Set,
): Pick<LayoutStore, "beginCorner" | "cornerMove" | "cornerUp" | "toggleSplitDir"> {
  return {
    toggleSplitDir: () => {
      const st = get();
      // 仅角标手势中有效(idle/docking/resizing 下 Tab 交还宿主页面，不劫持键盘导航)
      if (st.mode !== "corner" || st.hoverTId != null || !st.splitDir || st.srcId == null) return;
      const src = areaById(get, st.srcId);
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
      let src = areaById(get, st.srcId);
      if (!src) {
        if (Math.hypot(x - st.cornerStart.x, y - st.cornerStart.y) < runtime().cornerArm) return;
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
        if (Math.abs(dx) + Math.abs(dy) > runtime().edgeArm) {
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
      const src = areaById(get, st.srcId);
      const tgt = areaById(get, st.hoverTId);
      let status: string;
      const retype = new Map<number, string>(); // 内容类型变化(不可变落地)
      let mutated = false;                       // 几何/内容实际变化才入历史(纯取消不污染 undo)

      if (src && tgt && tgt !== src) {
        if (st.ctrl) {
          // 内容交换：contentType 互换 + 实例状态随同互换
          const srcT = src.contentType, tgtT = tgt.contentType;
          swapAreaState(src.id, tgt.id);
          retype.set(src.id, tgtT).set(tgt.id, srcT);
          status = `已交换「${contentName(srcT)}」与「${contentName(tgtT)}」内容。`;
          mutated = true;
        } else {
          const keep = G.joinAreas(s, src, tgt); // 保留角落源区，吸收目标
          if (keep) {
            removeAreaStates([tgt.id]);          // 被吞块实例状态随内容丢弃
            status = `已合并 → 「${contentName(keep.contentType)}」`;
            mutated = true;
          } else {
            status = "无法合并：两区域需共享整条分界线。";
          }
        }
      } else if (st.splitDir && src) {
        const fac = factorFromLine(get, src, st.splitDir, st.splitLine);
        const narea = G.split(s, src, st.splitDir, fac);
        if (narea) {
          cloneAreaState(src.id, narea.id); // 新生区域继承来源实例状态(clone)
          mutated = true;
        }
        status = narea
          ? `已分割「${contentName(src.contentType)}」→ 新区域「${contentName(narea.contentType)}」。新分界线可继续拖动。`
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
        past: mutated ? [...st.past, pre].slice(-runtime().historyMax) : st.past,
        future: mutated ? [] : st.future,
        screen: { ...s, areas: retypedAreas(s, retype) },
      });
    },
  };
}
