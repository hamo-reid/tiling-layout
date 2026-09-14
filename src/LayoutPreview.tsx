/**
 * LayoutPreview.tsx — 手势预览覆盖层(分割 / 合并 / 停靠)。
 *
 * 由 LayoutViewDom 在舞台内渲染；提供 `renderPreview` 插槽时交由消费方自绘。
 * 覆盖层 pointer-events:none,不挡交互。
 */
import * as G from "./geometry";
import type { ReactNode } from "react";
import { boxPct, pct } from "./domPct";
import type { DockTarget } from "./layoutStore";
import type { RenderSlots } from "./LayoutViewDom";

export interface LayoutPreviewProps {
  mode: "idle" | "corner" | "resizing" | "docking";
  slots?: RenderSlots | undefined;
  /** 角标手势：源区矩形 */
  srcRect: G.Rect | null;
  /** 角标手势：hover 目标区矩形(有则走合并预览) */
  tgtRect: G.Rect | null;
  splitDir: G.Axis | null;
  splitLine: number;
  /** 停靠：源区矩形 */
  dockSrcRect: G.Rect | null;
  /** 停靠：目标区矩形 */
  dockTgtRect: G.Rect | null;
  /** 停靠：四边槽矩形(比例) */
  dockSlot: G.Rect | null;
  dockTarget: DockTarget | undefined;
}

export function LayoutPreview({
  mode, slots, srcRect, tgtRect, splitDir, splitLine, dockSrcRect, dockTgtRect, dockSlot, dockTarget,
}: LayoutPreviewProps): ReactNode {
  const renderPreview = slots?.renderPreview;
  return (
    <>
      {/* 分割：仅角标手势、有源区与方向、且无 hover 目标 */}
      {mode === "corner" && srcRect && splitDir && !tgtRect && (
        <div className="tl-preview-layer">
          {renderPreview
            ? renderPreview({ mode: "split", srcRect, splitDir, splitLine })
            : (
              <>
                {[0, 1].map((i) => {
                  const blk: G.Rect = splitDir === G.AXIS.H
                    ? i === 0 ? G.withRect(srcRect, { ymax: splitLine - 0.003 }) : G.withRect(srcRect, { ymin: splitLine + 0.003 })
                    : i === 0 ? G.withRect(srcRect, { xmax: splitLine - 0.003 }) : G.withRect(srcRect, { xmin: splitLine + 0.003 });
                  if (blk.xmax <= blk.xmin || blk.ymax <= blk.ymin) return null;
                  return <div key={i} className="tl-preview-block" style={boxPct(blk)} />;
                })}
                <div className="tl-preview-line"
                     style={splitDir === G.AXIS.H
                       ? { left: pct(srcRect.xmin), top: `calc(${pct(1 - splitLine)} - 1.5px)`, width: pct(srcRect.width), height: 3 }
                       : { left: `calc(${pct(splitLine)} - 1.5px)`, top: pct(1 - srcRect.ymax), width: 3, height: pct(srcRect.height) }} />
              </>
            )}
        </div>
      )}

      {/* 合并(角落手势撞到相邻区) */}
      {mode === "corner" && srcRect && tgtRect && (
        <div className="tl-preview-layer">
          {renderPreview
            ? renderPreview({ mode: "join", srcRect, tgtRect })
            : (
              <>
                <div className="tl-preview-join" style={boxPct(tgtRect)} />
                <div className="tl-preview-src" style={boxPct(srcRect)} />
              </>
            )}
        </div>
      )}

      {/* 停靠 */}
      {mode === "docking" && dockSrcRect && (
        <div className="tl-preview-layer">
          {renderPreview
            ? renderPreview({
                mode: "dock",
                srcRect: dockSrcRect,
                tgtRect: dockTgtRect ?? undefined,
                dockTarget,
                slotRect: dockSlot ?? undefined,
              })
            : (
              <>
                <div className="tl-preview-ghost" style={boxPct(dockSrcRect)} />
                {dockTgtRect && dockTarget !== undefined && dockTarget !== "none" && (
                  dockTarget === "center"
                    ? <div className="tl-preview-center" style={boxPct(dockTgtRect)} />
                    : dockSlot && (
                        <>
                          <div className="tl-preview-target" style={boxPct(dockTgtRect)} />
                          <div className="tl-preview-slot" style={boxPct(dockSlot)} />
                        </>
                      )
                )}
              </>
            )}
        </div>
      )}
    </>
  );
}
