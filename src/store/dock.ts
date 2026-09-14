/**
 * store/dock.ts — 拖拽停靠手势(5 位热区：中心交换 / 四边分裂停靠)。
 *
 * 四边停靠两条落地路径：
 *   1) 源区与目标共享整边且无第三方可吞并 → 并集重排为两块(原位改尺寸);
 *   2) 否则目标内分裂出槽承载源内容,源区由"非目标"邻居吞并闭合。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { moveAreaState, swapAreaState } from "../areaStore";
import { collectSnapshot } from "../layoutData";
import type { DockTarget, LayoutStore } from "../layoutStore";
import { areaById, contentName, retypedAreas, sideLabel, snapFactor } from "./shared";

type Get = () => LayoutStore;
type Set = (partial: Partial<LayoutStore>) => void;

export function createDockActions(
  get: Get,
  set: Set,
): Pick<LayoutStore, "beginDock" | "dockMove" | "dockUp"> {
  return {
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
      const src = areaById(get, dk.srcId);
      if (!src) { set({ dock: null }); return; }
      const cur = G.findAreaAtXY(s, x, y);
      if (!cur || cur.id === dk.srcId) {
        set({ dock: { ...dk, targetId: null, target: "none" } });
        return;
      }
      const r = G.areaRect(s, cur);
      const fx = (x - r.xmin) / r.width;
      const fy = (y - r.ymin) / r.height;
      // 5 位停靠热区(中心半宽经 configureRuntime 可调)
      const dc = runtime().dockCenter;
      let target: DockTarget;
      if (fx >= dc && fx <= 1 - dc && fy >= dc && fy <= 1 - dc) {
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
      // 四边停靠可行性:源区可被"非目标"邻居吞并闭合,或源区与目标共享整边
      // (此时并集是矩形,可在 dockUp 里把并集重排为两块,无需第三方吞并)。
      const canClose = target === "center"
        || G.findSharedEdge(s, src, cur)
        || s.areas.some((nb) => nb !== cur && G.findSharedEdge(s, src, nb));
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
        const src = areaById(get, dk.srcId);
        const tgt = areaById(get, dk.targetId);
        if (!src || !tgt || tgt.id === dk.srcId || dk.target === "none") {
          status = "已取消";
        } else if (dk.target === "center") {
          // 中心停靠=交换内容（Area 对象不可变替换）
          const srcT = src.contentType, tgtT = tgt.contentType;
          swapAreaState(src.id, tgt.id);
          retype.set(src.id, tgtT).set(tgt.id, srcT);
          status = `已交换「${contentName(srcT)}」与「${contentName(tgtT)}」内容。`;
          mutated = true;
        } else if (
          // 源区仅与目标共享整边(无第三方邻居可吞并源区):并集是矩形,直接重排为两块。
          G.findSharedEdge(s, src, tgt)
          && !s.areas.some((nb) => nb !== src && nb !== tgt && G.findSharedEdge(s, src, nb))
        ) {
          const R = G.rect(
            Math.min(src.rect.xmin, tgt.rect.xmin),
            Math.min(src.rect.ymin, tgt.rect.ymin),
            Math.max(src.rect.xmax, tgt.rect.xmax),
            Math.max(src.rect.ymax, tgt.rect.ymax),
          );
          const f = Math.min(1, Math.max(0, dk.factorDock));
          let slotR: G.Rect;
          let otherR: G.Rect;
          if (dk.target === "left") {
            const cut = R.xmin + R.width * f;
            slotR = G.rect(R.xmin, R.ymin, cut, R.ymax);
            otherR = G.rect(cut, R.ymin, R.xmax, R.ymax);
          } else if (dk.target === "right") {
            const cut = R.xmax - R.width * f;
            slotR = G.rect(cut, R.ymin, R.xmax, R.ymax);
            otherR = G.rect(R.xmin, R.ymin, cut, R.ymax);
          } else if (dk.target === "bottom") {
            const cut = R.ymin + R.height * f;
            slotR = G.rect(R.xmin, R.ymin, R.xmax, cut);
            otherR = G.rect(R.xmin, cut, R.xmax, R.ymax);
          } else { // top
            const cut = R.ymax - R.height * f;
            slotR = G.rect(R.xmin, cut, R.xmax, R.ymax);
            otherR = G.rect(R.xmin, R.ymin, R.xmax, cut);
          }
          // 尺寸下限:两半任一低于最小宽/高即放弃(与分裂同一约束)
          const rt = runtime();
          const fits = slotR.width >= rt.minAreaW && otherR.width >= rt.minAreaW
            && slotR.height >= rt.minAreaH && otherR.height >= rt.minAreaH;
          if (!fits) {
            status = "目标区域过小，无法停靠。";
          } else {
            // 两区原位改尺寸:源内容落到停靠槽,目标内容落到另一块;不增删区域/不迁移状态。
            src.rect = slotR;
            tgt.rect = otherR;
            mutated = true;
            status = `已停靠「${contentName(src.contentType)}」到目标${sideLabel(dk.target)}。`;
          }
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
              status = `已停靠「${contentName(oldType)}」到目标${sideLabel(dk.target)}。`;
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
        past: mutated ? [...st.past, pre].slice(-runtime().historyMax) : st.past,
        future: mutated ? [] : st.future,
        screen: { ...s, areas: retypedAreas(s, retype) },
      });
    },
  };
}
