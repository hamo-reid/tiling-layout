/**
 * useLayoutGestureBridge.ts — 全局手势事件桥(窗口级监听 → layoutStore action)。
 *
 * 把 DOM 事件换算成数学坐标后派发给当前 mode 对应的 action：
 *   pointermove → cornerMove / resizeMove / dockMove
 *   mouseup     → cornerUp   / endResize  / dockUp
 *   Esc / 右键 / blur / pointercancel → cancel(或 Esc 退出最大化)
 *   Tab(仅角标中) → toggleSplitDir；Ctrl 按下态 → setCtrl
 *
 * 与 `usePointerDrag` 等其它手势共存：宿主面板在需要时自行 stopPropagation。
 */
import { useEffect } from "react";
import type { RefObject } from "react";
import { useLayout } from "./layoutStore";

/** 数学坐标(归一化比例) */
export interface MathPt { x: number; y: number }

/** 屏幕像素 → 归一化比例(x 向右、y 向上)。基准 = 舞台铺排盒 .tl-stage(与区域百分比
 *  定位同一坐标系;outerGap 内缩已含在其矩形里)。容器不可量测(0 宽高,如 display:none
 *  祖先或未布局)时返回 null——换算会产生 Infinity/NaN,一旦入库会被快照链路静默放大。 */
export function stagePointToMath(
  stage: HTMLElement | null,
  e: { clientX: number; clientY: number },
): MathPt | null {
  if (!stage) return null;
  const r = stage.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return {
    x: (e.clientX - r.left) / r.width,
    y: 1 - (e.clientY - r.top) / r.height,
  };
}

/**
 * 挂载全局手势事件桥；返回组件本地 onMouseDown 用的坐标换算函数。
 * @param stageRef `.tl-stage` 元素引用(坐标基准)
 */
export function useLayoutGestureBridge(
  stageRef: RefObject<HTMLElement | null>,
): (e: { clientX: number; clientY: number }) => MathPt | null {
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const m = stagePointToMath(stageRef.current, e);
      if (!m) return;
      const st = useLayout.getState();
      if (st.mode === "corner") st.cornerMove(m.x, m.y);
      else if (st.mode === "resizing") st.resizeMove(m.x, m.y);
      else if (st.mode === "docking") st.dockMove(m.x, m.y);
    };
    const up = (e: MouseEvent) => {
      if (e.button === 0) {
        const st = useLayout.getState();
        if (st.mode === "corner") st.cornerUp();
        else if (st.mode === "resizing") st.endResize();
        else if (st.mode === "docking") st.dockUp();
      }
    };
    const kd = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const st = useLayout.getState();
        if (st.mode !== "idle") st.cancel();
        else if (st.maximizedId != null) st.exitMaximize();
      }
      else if (e.key === "Tab") {
        // 仅角标手势中劫持 Tab(切换分割方向)；idle 等其余模式交还宿主页面，
        // 不再全局破坏浏览器键盘导航
        const st = useLayout.getState();
        if (st.mode === "corner") { e.preventDefault(); st.toggleSplitDir(); }
      }
      else if (e.key === "Control") useLayout.getState().setCtrl(true);
    };
    const ku = (e: KeyboardEvent) => { if (e.key === "Control") useLayout.getState().setCtrl(false); };
    const ctx = (e: MouseEvent) => {
      if (useLayout.getState().mode !== "idle") { e.preventDefault(); useLayout.getState().cancel(); }
    };
    // 手势中断兜底：指针移出浏览器窗口(窗口失焦)或触屏被系统打断(pointercancel)
    // 时收不到成对的 pointerup，手势会永久卡死——一律安全取消
    const abort = () => {
      const st = useLayout.getState();
      if (st.mode !== "idle") st.cancel();
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("contextmenu", ctx);
    window.addEventListener("blur", abort);
    window.addEventListener("pointercancel", abort);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("contextmenu", ctx);
      window.removeEventListener("blur", abort);
      window.removeEventListener("pointercancel", abort);
    };
  }, [stageRef]);

  return (e) => stagePointToMath(stageRef.current, e);
}
