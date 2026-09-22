/**
 * store/dock.ts — 拖拽停靠手势(5 位热区：中心交换 / 四边分裂停靠)。
 *
 * 四边停靠两条落地路径：
 *   1) 源区与目标共享整边且无第三方可吞并 → 并集重排为两块(原位改尺寸);
 *   2) 否则目标内分裂出槽承载源内容,源区由"非目标"邻居吞并闭合。
 *
 * 分裂与闭合都走命令层(`splitAt` / `planClose`+`applyClose`)：闭合逻辑过去在这里
 * 私有一份"找**单个**共享整边的邻居吞并"的写法，源区位置被多个邻居分摊(T 型交会)
 * 时只能取消；`planClose` 的多邻居分摊扩张补上了这个洞。
 */
import * as G from "../geometry";
import { runtime } from "../runtimeConfig";
import { moveAreaState } from "../areaStore";
import { beginMutation, areaById, contentName, landPatch, sideLabel, snapFactor } from "./shared";
import type { DockTarget, LayoutStore } from "../layoutStore";

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
      // 四边停靠可行性:源区可被"非目标"邻居吞并闭合(planClose 统一判定,含
      // T 型交会处的多邻居分摊),或源区与目标共享整边(并集重排,无需第三方吞并)。
      const canClose = target === "center"
        || G.findSharedEdge(s, src, cur)
        || G.planClose(s.areas, src.id, { exclude: [cur.id] }) !== null;
      const finalTarget: DockTarget = canClose ? target : "none";
      set({ dock: { ...dk, targetId: cur.id, target: finalTarget, factorDock, canClose } });
    },

    dockUp: () => {
      const st = get();
      const s = st.screen;
      const dk = st.dock;
      // 在克隆上试算：失败路径(目标过小 / 无法闭合)自然只剩"原屏未动"一种结果，
      // 不再需要手工回滚槽区
      const draft: G.Screen = { _id: s._id, areas: s.areas.map((a) => ({ ...a, rect: { ...a.rect } })) };
      let status = "已取消";
      let mutated = false;
      /** 需要一并搬迁实例状态的 [源 → 槽] 对 */
      let moved: { from: number; to: number } | null = null;
      const retype = new Map<number, string>();

      const src = dk ? draft.areas.find((a) => a.id === dk.srcId) ?? null : null;
      const tgt = dk ? draft.areas.find((a) => a.id === dk.targetId) ?? null : null;

      if (dk && src && tgt && tgt.id !== dk.srcId && dk.target !== "none") {
        if (dk.target === "center") {
          // 中心停靠 = 交换内容(实例状态随同互换)：整体交给命令，含入栈与状态栏
          const swapped = st.swapAreas(src.id, tgt.id);
          set({
            mode: "idle",
            dock: null,
            status: swapped ? `已交换「${contentName(src.contentType)}」与「${contentName(tgt.contentType)}」内容。` : "无法交换。",
          });
          return;
        }
        if (
          // 源区仅与目标共享整边(无第三方邻居可吞并源区):并集是矩形，直接重排为两块。
          G.findSharedEdge(draft, src, tgt)
          && !draft.areas.some((nb) => nb !== src && nb !== tgt && G.findSharedEdge(draft, src, nb))
        ) {
          const side = dk.target;
          const R = G.rect(
            Math.min(src.rect.xmin, tgt.rect.xmin),
            Math.min(src.rect.ymin, tgt.rect.ymin),
            Math.max(src.rect.xmax, tgt.rect.xmax),
            Math.max(src.rect.ymax, tgt.rect.ymax),
          );
          const slotR = G.dockSlotRect(R, side, dk.factorDock);
          const otherR = G.dockRestRect(R, side, dk.factorDock);
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
            status = `已停靠「${contentName(src.contentType)}」到目标${sideLabel(side)}。`;
          }
        } else {
          // 四边停靠：目标内分裂出槽承载拖区内容；源区由邻居吞并闭合
          const side = dk.target;
          const axis = (side === "left" || side === "right") ? G.AXIS.V : G.AXIS.H;
          const param = (side === "left" || side === "bottom") ? dk.factorDock : 1 - dk.factorDock;
          const split = G.splitAt(draft, tgt, axis, param);
          if (split === null) {
            status = "目标区域过小，无法停靠。";
          } else {
            // 停靠侧 = 槽。splitAt 的返回体直接给出 kept/created，
            // 不必再靠坐标比较反推哪半是槽(旧写法 left = ar.xmin < br.xmin ? tgt : slot)。
            const slot = side === "left" || side === "bottom" ? split.kept : split.created;
            const other = slot === split.kept ? split.created : split.kept;
            const oldType = src.contentType;
            // 移除源区：并入邻居闭合(排除槽与目标 —— 它们不能当吞并方)
            const plan = G.planClose(draft.areas, src.id, { exclude: [slot.id, other.id] });
            if (plan === null) {
              status = "无法闭合源区位置，已取消停靠。";
            } else {
              G.applyClose(draft, plan);
              retype.set(slot.id, oldType);            // 拖区内容进槽(槽本继承目标的类型)
              moved = { from: src.id, to: slot.id };   // 源内容进槽：实例状态随之转移
              status = plan.spanned
                ? `已停靠「${contentName(oldType)}」到目标${sideLabel(side)}（源区由 ${plan.expansions.map((e) => e.id).join("、")} 分摊闭合）。`
                : `已停靠「${contentName(oldType)}」到目标${sideLabel(side)}。`;
              mutated = true;
            }
          }
        }
      }

      if (mutated && moved !== null) moveAreaState(moved.from, moved.to);
      set({
        // 失败路径必须丢弃 draft：试算时已经分裂过目标区，未落地时原屏分毫未动
        ...landPatch(st, {
          screen: mutated ? draft : s,
          retype,
          status,
          pre: mutated ? beginMutation(s) : "",
          mutated,
        }),
        mode: "idle",
        dock: null,
      });
    },
  };
}
