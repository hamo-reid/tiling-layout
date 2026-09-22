/**
 * store/resize.ts — 拖拽分界线调整大小(连通线族整体平移、矩形保持)。
 *
 * 夹逼与"把同一坐标写给族内每个成员"这两件事在 `geometry/commands.ts`
 * (`lineBounds` / `planLineTo` / `applyLineTo`)，与 `setRatio` 命令共用一份实现
 * —— 拖拽与按比例设定本来是同一个动作的两种输入方式，不该各算一遍。
 */
import * as G from "../geometry";
import { beginMutation, landPatch } from "./shared";
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
      // 线族与夹逼必须在动手之前解出来(线一离开原坐标就再也匹配不到族)
      const bounds = G.lineBounds(s, seg);
      set({
        mode: "resizing",
        resize: {
          seg,
          dir,
          orig,
          origPt: dir === G.AXIS.V ? m.x : m.y,
          bounds,
          // 兼容字段(0.4.0 的读取方)：同一份数据的展开视图，不经第二套算法
          moved: bounds === null ? [] : [...bounds.family],
          adj: bounds === null ? [] : [...bounds.limits],
          pre: beginMutation(s),                     // 拖拽前快照：实际位移才入栈
          // 族成员 + 各自拖拽前的 Rect 引用(旧 Rect 对象完好 → cancel 可原样回滚)
          origRects: (bounds?.family ?? []).map(({ area }) => ({ area, rect: area.rect })),
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
      if (!r || r.bounds === null) return;
      const curAxis = r.dir === G.AXIS.V ? x : y;
      if (!Number.isFinite(curAxis)) return;   // 程序化调用兜底(DOM 桥已保证有限值)
      const to = G.clampLine(r.bounds, r.orig + (curAxis - r.origPt));
      // 仅「从未位移」时跳过写入(避免引用抖动)；已位移后指针精确回到起点也必须
      // 写回 orig——否则几何停在最后一次位移位置，与指针目视位置不符
      if (to === r.orig && !r.dragged) return;
      r.dragged = true;
      G.writeLine(r.seg, r.bounds, to);
      set({ screen: { ...get().screen } });
    },

    endResize: () => {
      const st = get();
      const r = st.resize;
      // 实际发生位移才入历史栈(压入拖拽前快照)；纯点击分界线不产生 undo 条目
      const dragged = r?.dragged ?? false;
      set({
        ...landPatch(st, {
          screen: st.screen,
          status: "就绪",
          pre: r?.pre ?? "",
          mutated: dragged,
        }),
        mode: "idle",
        resize: null,
      });
    },
  };
}
