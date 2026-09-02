import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import * as G from "./geometry";
import { installInitialLayout, isLayoutBootstrapped, isPristineScreen } from "./initialLayout";
import type { InitialLayout } from "./initialLayout";
import { useLayout } from "./layoutStore";
import type { DockTarget } from "./layoutStore";
import { Content, getContentTitle } from "./registry";
import { configToCssVars } from "./theme";
import type { LayoutConfig } from "./theme";
import { useWorkspaces } from "./workspaces";

/**
 * 渲染插槽：定制"可见内容"，交互宿主(头部拖拽停靠/角标命中/分界线拖拽)仍由 lib 保留。
 * 返回的 JSX 渲染进对应宿主内；不传则用默认外观(零回归)。
 * @category 渲染与主题
 */
export interface RenderSlots {
  /** 区域头部条：返回的 JSX 渲染进头部(默认为可拖拽标题条)。
   *  ctx: areaId 区域 id / contentType 内容类型 / title 解析后的标题 */
  renderHeader?: (ctx: { areaId: number; contentType: string; title: string }) => ReactNode;
  /** 角标(十字手柄)：ctx 含区域 id、归一化坐标 x/y、角标 hover 关联的共享区域 id 集合、hover 状态 */
  renderCorner?: (ctx: { areaId: number; x: number; y: number; sharedIds: number[]; hovered: boolean }) => ReactNode;
  /** 分界线胶囊：hovered 表示该线(或其同向连通族)正被 hover。
   *  推荐 hover 时才返回可见手柄(如 {hovered ? <胶囊/> : null})，平时保持空白——
   *  一条被 T 型/十字点切分的长线不会同时冒出多个胶囊；整条连通线由 .tl-asplit-hot 高亮。 */
  renderEdge?: (ctx: { edgeId: number; vertical: boolean; hovered: boolean }) => ReactNode;
  /** 区域盒视觉层：铺满该区域、位于内容之下。提供后库会去掉默认背景/描边，完全由你接管。
   *  rect 为归一化比例矩形(渲染层换算像素)，hot 表示该区域正被角标 hover(关联)。 */
  renderArea?: (ctx: {
    areaId: number;
    contentType: string;
    title: string;
    rect: G.Rect;
    hot: boolean;
  }) => ReactNode;
  /** 预览层：分割/合并/停靠的视觉提示(覆盖层、不挡交互)。提供后取代库默认 tl-preview-* 样式。
   *  rects/坐标均为归一化比例；渲染时换算百分比(如 left: `${r.xmin*100}%`)。 */
  renderPreview?: (ctx: {
    mode: "split" | "join" | "dock";
    srcRect: G.Rect;
    tgtRect?: G.Rect;
    splitDir?: G.Axis;
    splitLine?: number;
    dockTarget?: DockTarget;
    slotRect?: G.Rect;
  }) => ReactNode;
}

/**
 * LayoutViewDom — 库的(唯一)渲染组件，真实 DOM，可承载任意 React 内容。
 *
 * 几何与状态机(layoutStore)完全复用，只换表现层。坐标采用**归一化比例 [0,1]×[0,1]**，
 * 每个元素用百分比(×容器像素)定位 —— 区域随容器**真实拉伸/重排，无缩放、无留边、无失真**；
 * 角标等 chrome 用固定 px(calc)，不随容器缩放，任何容器尺寸下都可命中。
 *   - 区域   : 绝对定位 <div>，头部条可拖拽停靠(beginDock)，下方可放任意真实内容
 *   - 分界线 : 细条 <div>，可拖拽改大小(beginResize)
 *   - 角标   : <button> 十字，拖拽分割/合并/交换(beginCorner)，hover 高亮共享块
 *   - 预览   : 覆盖层 <div>(split/join/dock)，pointer-events:none
 */

/** 归一化比例矩形 → DOM 百分比盒(含 y 翻转：top 用 (1-ymax)) */
function boxPct(r: G.Rect) {
  const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;
  return {
    left: pct(r.xmin),
    top: pct(1 - r.ymax),
    width: pct(r.xmax - r.xmin),
    height: pct(r.ymax - r.ymin),
  };
}

/** 库的(唯一)渲染组件的 props
 * @category 渲染与主题
 */
export interface LayoutViewDomProps {
  /** 视觉/间距配置(实例级覆盖，展开为 --tl-* CSS 变量) */
  theme?: LayoutConfig;
  /** 渲染插槽(定制头部/角标/分界线/区域盒/预览层；不传用默认外观) */
  slots?: RenderSlots;
  /** 容器定位策略：
   *   - "absolute"(默认)：铺满最近 positioned 祖先的 padding-box(需父元素有定位上下文)
   *   - "flow"：正常文档流元素，宽高 100% 撑满父元素 content-box —— 父元素无需 position，
   *     padding 自动内缩舞台、margin 天然在外侧。要求父级有确定高度(否则塌 0 高，
   *     库会 console.warn 提示)。 */
  positioning?: "absolute" | "flow";
  /** 透传到 .tl-stage-wrap 的内联样式(如自定义 padding/margin/背景/混合定位) */
  style?: CSSProperties;
  /** 初始布局：组件挂载时若 store 仍为原始默认布局则应用(声明式，见 InitialLayout)。
   *  仅「仍是默认」时生效，交互过或重挂载不会把用户已改的布局冲回初始值。 */
  initialLayout?: InitialLayout;
}

/** 库的(唯一)渲染组件：把 layoutStore 的几何渲染为可交互 DOM。
 *  @param props `theme` 视觉/间距配置(实例级覆盖，展开为 --tl-* CSS 变量)；
 *               `slots` 渲染插槽(定制头部/角标/分界线/区域盒/预览层；不传用默认外观)
 * @category 渲染与主题
 */
export function LayoutViewDom(props: LayoutViewDomProps = {}) {
  const { theme, slots, positioning = "absolute", style, initialLayout } = props;
  const screen = useLayout((s) => s.screen);
  const mode = useLayout((s) => s.mode);
  const splitDir = useLayout((s) => s.splitDir);
  const splitLine = useLayout((s) => s.splitLine);
  const hoverTId = useLayout((s) => s.hoverTId);
  const srcId = useLayout((s) => s.srcId);
  const dock = useLayout((s) => s.dock);
  const beginCorner = useLayout((s) => s.beginCorner);
  const beginResize = useLayout((s) => s.beginResize);
  const beginDock = useLayout((s) => s.beginDock);
  const maximizedId = useLayout((s) => s.maximizedId);
  const toggleMaximize = useLayout((s) => s.toggleMaximize);
  const isMax = maximizedId != null;

  const wrapRef = useRef<HTMLDivElement>(null);
  const [hotIds, setHotIds] = useState<number[]>([]);
  const [hoverEdgeId, setHoverEdgeId] = useState<number | null>(null);
  const [hoverCorner, setHoverCorner] = useState<string | null>(null);
  /** flow 0 高兜底告警只报一次 */
  const warnedFlowRef = useRef(false);

  /** 推导分界线段(矩形平铺的派生数据；id 确定性分配，可直接用作 key 与交互标识) */
  const segs = useMemo(() => G.deriveEdges(screen), [screen]);

  /** hover 所在线段的同向连通线族：一条被 T 型/十字点切分的长线，hover 任一段即整条高亮 */
  const hoverFamily = useMemo(() => {
    if (hoverEdgeId == null) return new Set<number>();
    const seg = segs.find((x) => x.id === hoverEdgeId);
    if (!seg) return new Set<number>();
    return new Set([...G.connectedSegs(screen, seg)].map((x) => x.id));
  }, [hoverEdgeId, segs, screen]);

  /** 屏幕像素 → 归一化比例(x 向右、y 向上)。
   *  容器不可量测(0 宽高，如 display:none 祖先或未布局)时返回 null——
   *  此时换算会产生 Infinity/NaN，一旦入库会被快照链路静默放大成数据丢失 */
  const ptToMath = (e: { clientX: number; clientY: number }) => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return {
      x: (e.clientX - r.left) / r.width,
      y: 1 - (e.clientY - r.top) / r.height,
    };
  };

  // 全局事件桥
  useEffect(() => {
    const mv = (e: PointerEvent) => {
      const m = ptToMath(e);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // flow 模式 0 高兜底告警：父级 auto/min-height 时 height:100% 退化为 auto、唯一子元素
  // 又是 absolute → 舞台塌 0 高空白无任何提示。主动 warn 把静默失败变可诊断(参照 allotment FAQ)
  useEffect(() => {
    if (positioning !== "flow" || warnedFlowRef.current) return;
    const r = wrapRef.current?.getBoundingClientRect();
    if (r && r.height <= 0) {
      warnedFlowRef.current = true;
      console.warn(
        "[tiling-layout] flow 模式下舞台高度为 0（也可能容器被隐藏或尚未布局）：" +
        "父容器缺少确定高度时舞台会塌陷，请给父元素显式 height 或 flex 链",
      );
    }
  }, [positioning]);

  // initialLayout 引导：页面级一次(模块级标记)，且仅在「活跃种子布局仍是最初状态」时应用。
  // 交互过(几何/内容/场景变化)、活跃工作区非种子、或已被其它实例/程序化 install 引导过
  // 都跳过——重挂载、迟到传入(prop 后到)不会冲掉用户数据。
  // useLayoutEffect 在 paint 前应用，避免首帧闪默认三区。
  useLayoutEffect(() => {
    if (!initialLayout || isLayoutBootstrapped()) return;
    if (useWorkspaces.getState().activeId !== "layout-1") return;
    if (!isPristineScreen()) return;
    installInitialLayout(initialLayout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLayout]);

  // 角标按唯一坐标去重并记录共享块(区域矩形四角)
  const corners = (() => {
    const map = new Map<string, { x: number; y: number; ids: number[] }>();
    for (const a of screen.areas) {
      const r = a.rect;
      for (const [x, y] of [[r.xmin, r.ymin], [r.xmin, r.ymax], [r.xmax, r.ymax], [r.xmax, r.ymin]]) {
        const k = `${x.toFixed(6)}_${y.toFixed(6)}`;
        const e = map.get(k) ?? { x, y, ids: [] };
        if (!e.ids.includes(a.id)) e.ids.push(a.id);
        map.set(k, e);
      }
    }
    return [...map.values()];
  })();

  // 预览数据
  const src = srcId == null ? null : screen.areas.find((a) => a.id === srcId) ?? null;
  const tgt = hoverTId == null ? null : screen.areas.find((a) => a.id === hoverTId) ?? null;
  const srcR = src ? G.areaRect(screen, src) : null;
  const tgtR = tgt ? G.areaRect(screen, tgt) : null;
  const dkSrc = dock ? (screen.areas.find((a) => a.id === dock.srcId) ?? null) : null;
  const dkTgtR = dock && dock.targetId != null
    ? (screen.areas.find((a) => a.id === dock.targetId) ?? null) : null;
  const dkTgtRect = dkTgtR ? G.areaRect(screen, dkTgtR) : null;
  const dkSrcR = dkSrc ? G.areaRect(screen, dkSrc) : null;
  // 停靠四边的槽矩形(比例)——改单边走 withRect，保证 width/height 派生字段同步
  const dkSlot: G.Rect | null = dock && dkTgtRect && dock.target !== "none" && dock.target !== "center"
    ? (() => {
        const f = dock.factorDock;
        return dock.target === "left"
          ? G.withRect(dkTgtRect, { xmax: dkTgtRect.xmin + dkTgtRect.width * f })
          : dock.target === "right"
            ? G.withRect(dkTgtRect, { xmin: dkTgtRect.xmax - dkTgtRect.width * f })
            : dock.target === "bottom"
              ? G.withRect(dkTgtRect, { ymax: dkTgtRect.ymin + dkTgtRect.height * f })
              : G.withRect(dkTgtRect, { ymin: dkTgtRect.ymax - dkTgtRect.height * f });
      })()
    : null;

  const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;

  return (
    <div className="tl-stage-wrap" ref={wrapRef} data-positioning={positioning}
         style={{ ...configToCssVars(theme, { partial: true }), ...style }}>
      <div className="tl-stage">
        {/* 区域 */}
        {screen.areas.map((a) => {
          const b = boxPct(G.areaRect(screen, a));
          const isHot = hotIds.includes(a.id);
          const hasCustomArea = !!slots?.renderArea;
          // 最大化：目标区域铺满舞台，其余区域隐藏(保持挂载 → 实例状态/areaInstances 连续)
          const rect = isMax && a.id === maximizedId
            ? { left: 0, top: 0, width: "100%", height: "100%" }
            : b;
          return (
            <div className={`tl-area-box${isHot ? " tl-hot" : ""}${hasCustomArea ? " tl-custom" : ""}`} key={a.id}
                 style={{
                   ...rect,
                   ...(isMax && a.id !== maximizedId ? { display: "none" } : null),
                 }}>
              {slots?.renderArea && (
                <div className="tl-area-layer">
                  {slots.renderArea({
                    areaId: a.id,
                    contentType: a.contentType,
                    title: getContentTitle(a.contentType),
                    rect: G.areaRect(screen, a),
                    hot: isHot,
                  })}
                </div>
              )}
              <div className="tl-ahead"
                   onMouseDown={(e) => {
                     if (e.button === 0 && !isMax) {
                       const m = ptToMath(e);
                       if (!m) return;
                       e.preventDefault();
                       beginDock(a.id, m);
                     }
                   }}
                   onDoubleClick={() => toggleMaximize(a.id)}>
                {slots?.renderHeader
                  ? slots.renderHeader({ areaId: a.id, contentType: a.contentType, title: getContentTitle(a.contentType) })
                  : getContentTitle(a.contentType)}
              </div>
              <Content type={a.contentType} areaId={a.id} />
            </div>
          );
        })}

        {/* 分界线(推导线段) */}
        {!isMax && segs.map((e) => {
          const v = e.v1, w = e.v2;
          const vert = v.x === w.x;
          return (
            <div key={e.id} className={`tl-asplit${hoverFamily.has(e.id) ? " tl-asplit-hot" : ""}`} data-vertical={String(vert)}
                 style={vert
                   ? { left: `calc(${pct(v.x)} - 3px)`, top: pct(1 - Math.max(v.y, w.y)), width: 6, height: pct(Math.abs(w.y - v.y)) }
                   : { left: `calc(${pct(Math.min(v.x, w.x))} - 3px)`, top: `calc(${pct(1 - v.y)} - 3px)`, width: pct(Math.abs(w.x - v.x)), height: 6 }}
                 onMouseEnter={() => setHoverEdgeId(e.id)}
                 onMouseLeave={() => setHoverEdgeId(null)}
                 onMouseDown={(ev) => {
                   if (ev.button === 0) {
                     const m = ptToMath(ev);
                     if (!m) return;
                     ev.preventDefault();
                     beginResize(e, m);
                   }
                 }}>
                {slots?.renderEdge ? slots.renderEdge({ edgeId: e.id, vertical: vert, hovered: hoverEdgeId === e.id }) : null}
              </div>
          );
        })}

        {/* 角标 */}
        {!isMax && corners.map((c, i) => {
          const renderCorner = slots?.renderCorner;
          const hasCustom = !!renderCorner;
          const ck = `${c.x.toFixed(6)}_${c.y.toFixed(6)}`;
          return (
            <button type="button" key={i} className={`tl-corner${hasCustom ? " tl-custom" : ""}`}
                    style={{ left: `calc(${pct(c.x)} - 7px)`, top: `calc(${pct(1 - c.y)} - 7px)` }}
                    onMouseDown={(e) => {
                      const m = ptToMath(e);
                      if (!m) return;
                      e.preventDefault();
                      e.stopPropagation();
                      beginCorner(c.ids[0], m, e.ctrlKey);
                    }}
                    onMouseEnter={() => { setHotIds(c.ids); setHoverCorner(ck); }}
                    onMouseLeave={() => { setHotIds([]); setHoverCorner(null); }}>
              {renderCorner
                ? renderCorner({ areaId: c.ids[0], x: c.x, y: c.y, sharedIds: c.ids, hovered: hoverCorner === ck })
                : null}
            </button>
          );
        })}

        {/* 预览：分割 / 合并 / 停靠 —— 可用 renderPreview 自定义 */}
        {mode === "corner" && srcR && splitDir && !tgtR && (
          <div className="tl-preview-layer">
            {slots?.renderPreview
              ? slots.renderPreview({ mode: "split", srcRect: srcR, splitDir, splitLine })
              : (
                <>
                  {[0, 1].map((i) => {
                    const blk: G.Rect = splitDir === G.AXIS.H
                      ? i === 0 ? G.withRect(srcR, { ymax: splitLine - 0.003 }) : G.withRect(srcR, { ymin: splitLine + 0.003 })
                      : i === 0 ? G.withRect(srcR, { xmax: splitLine - 0.003 }) : G.withRect(srcR, { xmin: splitLine + 0.003 });
                    if (blk.xmax <= blk.xmin || blk.ymax <= blk.ymin) return null;
                    return <div key={i} className="tl-preview-block" style={boxPct(blk)} />;
                  })}
                  <div className="tl-preview-line"
                       style={splitDir === G.AXIS.H
                         ? { left: pct(srcR.xmin), top: `calc(${pct(1 - splitLine)} - 1.5px)`, width: pct(srcR.width), height: 3 }
                         : { left: `calc(${pct(splitLine)} - 1.5px)`, top: pct(1 - srcR.ymax), width: 3, height: pct(srcR.height) }} />
                </>
              )}
          </div>
        )}
        {mode === "corner" && srcR && tgtR && (
          <div className="tl-preview-layer">
            {slots?.renderPreview
              ? slots.renderPreview({ mode: "join", srcRect: srcR, tgtRect: tgtR })
              : (
                <>
                  <div className="tl-preview-join" style={boxPct(tgtR)} />
                  <div className="tl-preview-src" style={boxPct(srcR)} />
                </>
              )}
          </div>
        )}
        {mode === "docking" && dkSrcR && (
          <div className="tl-preview-layer">
            {slots?.renderPreview
              ? slots.renderPreview({
                  mode: "dock",
                  srcRect: dkSrcR,
                  tgtRect: dkTgtRect ?? undefined,
                  dockTarget: dock?.target,
                  slotRect: dkSlot ?? undefined,
                })
              : (
                <>
                  <div className="tl-preview-ghost" style={boxPct(dkSrcR)} />
                  {dkTgtRect && dock && dock.target !== "none" && (
                    dock.target === "center"
                      ? <div className="tl-preview-center" style={boxPct(dkTgtRect)} />
                      : dkSlot && (
                          <>
                            <div className="tl-preview-target" style={boxPct(dkTgtRect)} />
                            <div className="tl-preview-slot" style={boxPct(dkSlot)} />
                          </>
                        )
                  )}
                </>
              )}
          </div>
        )}
      </div>
    </div>
  );
}