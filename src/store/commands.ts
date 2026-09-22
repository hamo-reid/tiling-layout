/**
 * store/commands.ts — 命令式排布 action(收 id、返回纯数据、单点入栈)。
 *
 * 与三个手势模块的分工：手势把指针换算成参数后**调用这里的同一份几何实现**
 * (`geometry/commands.ts`)，不再各算一遍；本模块负责命令特有的三件事：
 *   1. **克隆后编辑** —— 编辑失败(几何不成立/合法性不过)时原屏分毫未动，
 *      这是程序化调用方要的语义(手势则是"就地改 + cancel 回滚")；
 *   2. **实例状态迁移** —— split 克隆源区槽位、close/merge 丢弃被删槽位、
 *      swap 互换槽位，与几何动作成对发生，不能再让调用方各自记；
 *   3. **一次入栈** —— 统一经 `store/shared.landPatch`。
 *
 * 命令一律幂等、不 toggle(手势要的"再点一次切回来"留在手势里)；都会清空在手势
 * 中间态(见 `IDLE_GESTURE` 的说明)。
 */
import * as G from "../geometry";
import { areaEntries, checkTiling, tilingOk } from "../invariants";
import { cloneAreaState, removeAreaStates, swapAreaState } from "../areaStore";
import type {
  CloseResult, LayoutStore, MergeResult, RatioResult, SplitResult, SwapResult,
} from "../layoutStore";
import { areaById, beginMutation, contentName, IDLE_GESTURE, landPatch } from "./shared";

type Get = () => LayoutStore;
type Set = (partial: Partial<LayoutStore>) => void;

/** 克隆一屏：区域对象与 rect 都换新，编辑失败时原屏分毫未动 */
function draftOf(s: G.Screen): G.Screen {
  return { _id: s._id, areas: s.areas.map((a) => ({ ...a, rect: { ...a.rect } })) };
}

export function createLayoutCommands(
  get: Get,
  set: Set,
): Pick<LayoutStore, "splitArea" | "closeArea" | "mergeAreas" | "swapAreas" | "setRatio" | "setMaximized"> {
  /** 提交前的统一闸门：几何不合法即整单放弃(零改动)。满铺不检查 —— 部分平铺是合法用法 */
  const legal = (draft: G.Screen): boolean => tilingOk(checkTiling(areaEntries(draft.areas)));

  return {
    splitArea: (id, dir, ratio = 0.5) => {
      const st = get();
      const preview = areaById(get, id);
      if (preview === null) return null;
      const draft = draftOf(st.screen);
      const target = draft.areas.find((a) => a.id === id);
      if (target === undefined) return null;
      const res = G.splitAt(draft, target, dir, ratio);
      if (res === null || !legal(draft)) return null;

      const pre = beginMutation(st.screen);
      cloneAreaState(id, res.created.id);            // 新块继承源区实例状态
      set({
        ...landPatch(st, {
          screen: draft,
          status: `已分割「${contentName(target.contentType)}」→ 新区域 id=${res.created.id}`,
          pre,
          mutated: true,
        }),
        ...IDLE_GESTURE,
      });
      return { kept: id, created: res.created.id } satisfies SplitResult;
    },

    closeArea: (id, opts = {}) => {
      const st = get();
      if (areaById(get, id) === null) return null;
      if (st.screen.areas.length <= 1) return null;   // 只剩一块，关掉就没得铺了
      const plan = G.planClose(st.screen.areas, id, opts.exclude === undefined ? {} : { exclude: opts.exclude });
      // opts.side 是"只接受这一侧"的强制口：启发式以后想改不必改签名
      if (plan === null || (opts.side !== undefined && plan.side !== opts.side)) return null;
      const draft = draftOf(st.screen);
      G.applyClose(draft, plan);
      if (!legal(draft)) return null;

      const pre = beginMutation(st.screen);
      removeAreaStates([id]);                          // 被删区域的实例状态一并丢弃
      set({
        ...landPatch(st, {
          screen: draft,
          status: plan.spanned
            ? `已关闭 id=${id} → 由 ${plan.expansions.map((e) => e.id).join("、")} 分摊`
            : `已关闭 id=${id} → 并入 id=${plan.expansions.map((e) => e.id).join("、")}`,
          pre,
          mutated: true,
        }),
        ...IDLE_GESTURE,
      });
      return {
        closed: id,
        side: plan.side,
        spanned: plan.spanned,
        absorbedBy: plan.expansions.map((e) => e.id),
      } satisfies CloseResult;
    },

    mergeAreas: (keepId, removeId) => {
      const st = get();
      const keep = areaById(get, keepId);
      const remove = areaById(get, removeId);
      if (keep === null || remove === null || keepId === removeId) return null;
      const draft = draftOf(st.screen);
      const k = draft.areas.find((a) => a.id === keepId);
      const r = draft.areas.find((a) => a.id === removeId);
      if (k === undefined || r === undefined) return null;
      // 语义：保留 keep 的内容，丢弃 remove 的(库 joinAreas 的定义)
      if (G.joinAreas(draft, k, r) === null || !legal(draft)) return null;

      const pre = beginMutation(st.screen);
      removeAreaStates([removeId]);
      set({
        ...landPatch(st, {
          screen: draft,
          status: `已合并 id=${removeId} → 「${contentName(keep.contentType)}」`,
          pre,
          mutated: true,
        }),
        ...IDLE_GESTURE,
      });
      return { keep: keepId, dropped: removeId, droppedContent: remove.contentType } satisfies MergeResult;
    },

    swapAreas: (a, b) => {
      const st = get();
      const A = areaById(get, a);
      const B = areaById(get, b);
      if (A === null || B === null || a === b) return null;
      const retype = new Map<number, string>([[a, B.contentType], [b, A.contentType]]);
      const pre = beginMutation(st.screen);
      // 实例状态与内容一起换槽(即使两侧类型相同也要换：状态确实动了，属真实变更)
      swapAreaState(a, b);
      set({
        ...landPatch(st, {
          screen: st.screen,
          retype,
          status: `已交换「${contentName(A.contentType)}」与「${contentName(B.contentType)}」内容`,
          pre,
          mutated: true,
        }),
        ...IDLE_GESTURE,
      });
      return { a, b } satisfies SwapResult;
    },

    setRatio: (seg, ratio) => {
      const st = get();
      const plan = G.planRatio(st.screen, seg, ratio);
      if (plan === null) return null;
      const draft = draftOf(st.screen);
      const moved = G.applyLineTo(draft, seg, plan.to);
      if (moved === null || !legal(draft)) return null;
      if (moved.to === moved.from) return null;         // 已在目标位置：不入栈、不落地

      const pre = beginMutation(st.screen);
      set({
        ...landPatch(st, {
          screen: draft,
          status: `分界线 ${moved.from.toFixed(3)} → ${moved.to.toFixed(3)}(${moved.members} 块随之平移)`,
          pre,
          mutated: true,
        }),
        ...IDLE_GESTURE,
      });
      return { from: moved.from, to: moved.to, axis: moved.axis, members: moved.members } satisfies RatioResult;
    },

    setMaximized: (id) => {
      const st = get();
      if (id !== null && !st.screen.areas.some((a) => a.id === id)) return;
      if (st.maximizedId === id) return;                // 幂等：已是目标态
      // 视图态：**不进历史**(不改几何与快照，切换/恢复布局时清空)，故不走 landPatch
      set({ maximizedId: id, ...IDLE_GESTURE });
    },
  };
}
