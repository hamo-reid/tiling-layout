/**
 * store/resize.ts — 拖拽分界线调整大小(连通线族整体平移、矩形保持)。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { collectSnapshot } from "../layoutData";
import type { LayoutStore } from "../layoutStore";

type Get = () => LayoutStore;
type Set = (partial: Partial<LayoutStore>) => void;

export function createResizeActions(
  get: Get,
  set: Set,
): Pick<LayoutStore, "beginResize" | "resizeMove" | "endResize"> {
  return {
    beginResize: (seg, m) => {
      const s = get().screen;
      const dir: G.Axis = seg.v1.x === seg.v2.x ? G.AXIS.V : G.AXIS.H;
      const orig = dir === G.AXIS.V ? seg.v1.x : seg.v1.y;
      const moved = G.edgeFamilyAreas(s, seg);
      // 夹逼约束必须覆盖线族「全部」成员：min 侧矩形(内边触线)约束线不可越过
      // 自身近边+MIN，max 侧对称。只看与命中段区间完全贴齐的成员会漏掉横跨
      // 整线的对侧矩形(如全高区域)——把它拖破 MIN 甚至负宽(几何反转)。
      const adj: { min?: number; max?: number }[] = [];
      const rt = runtime();
      for (const { area, side } of moved) {
        const r = area.rect;
        if (side === "min") {
          adj.push(dir === G.AXIS.V ? { min: r.xmin + rt.minAreaW } : { min: r.ymin + rt.minAreaH });
        } else {
          adj.push(dir === G.AXIS.V ? { max: r.xmax - rt.minAreaW } : { max: r.ymax - rt.minAreaH });
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
        past: dragged ? [...st.past, r!.pre].slice(-runtime().historyMax) : st.past,
        future: dragged ? [] : st.future,
        screen: { ...s },
      });
    },
  };
}
