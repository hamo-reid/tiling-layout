// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LayoutPreview } from "../src/LayoutPreview";
import type { LayoutPreviewProps } from "../src/LayoutPreview";
import * as G from "../src/geometry";
import type { RenderSlots } from "../src/LayoutViewDom";

const SRC = G.rect(0, 0, 0.5, 0.5);
const TGT = G.rect(0.5, 0, 1, 0.5);

function baseProps(over: Partial<LayoutPreviewProps> = {}): LayoutPreviewProps {
  return {
    mode: "idle",
    slots: undefined,
    srcRect: null,
    tgtRect: null,
    splitDir: null,
    splitLine: 0.5,
    dockSrcRect: null,
    dockTgtRect: null,
    dockSlot: null,
    dockTarget: undefined,
    ...over,
  };
}

describe("LayoutPreview 默认预览(无插槽)", () => {
  it("idle 不渲染预览层", () => {
    const { container } = render(<LayoutPreview {...baseProps()} />);
    expect(container.querySelector(".tl-preview-layer")).toBeNull();
  });

  it("分割(水平):两块 + 分割线", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, splitDir: G.AXIS.H, splitLine: 0.25 })} />,
    );
    expect(container.querySelectorAll(".tl-preview-block")).toHaveLength(2);
    expect(container.querySelector(".tl-preview-line")).not.toBeNull();
  });

  it("分割(垂直):走另一轴分支", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, splitDir: G.AXIS.V, splitLine: 0.25 })} />,
    );
    expect(container.querySelectorAll(".tl-preview-block")).toHaveLength(2);
    expect(container.querySelector(".tl-preview-line")).not.toBeNull();
  });

  it("分割线贴边使某块非法 → 该块不渲染", () => {
    const thin = G.rect(0, 0, 0.5, 0.05);
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "corner", srcRect: thin, splitDir: G.AXIS.H, splitLine: 0.003 })} />,
    );
    // 上半块 ymax=0 ≤ ymin=0 被剔除,只剩下半块
    expect(container.querySelectorAll(".tl-preview-block")).toHaveLength(1);
  });

  it("合并:join + src 两块", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, tgtRect: TGT })} />,
    );
    expect(container.querySelector(".tl-preview-join")).not.toBeNull();
    expect(container.querySelector(".tl-preview-src")).not.toBeNull();
  });

  it("停靠(中心):ghost + center", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "docking", dockSrcRect: SRC, dockTgtRect: TGT, dockTarget: "center" })} />,
    );
    expect(container.querySelector(".tl-preview-ghost")).not.toBeNull();
    expect(container.querySelector(".tl-preview-center")).not.toBeNull();
  });

  it("停靠(四边):ghost + target + slot", () => {
    const slot = G.rect(0.5, 0, 0.6, 0.5);
    const { container } = render(
      <LayoutPreview {...baseProps({
        mode: "docking", dockSrcRect: SRC, dockTgtRect: TGT, dockSlot: slot, dockTarget: "left",
      })} />,
    );
    expect(container.querySelector(".tl-preview-ghost")).not.toBeNull();
    expect(container.querySelector(".tl-preview-target")).not.toBeNull();
    expect(container.querySelector(".tl-preview-slot")).not.toBeNull();
  });

  it("停靠 target=none → 仅 ghost", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "docking", dockSrcRect: SRC, dockTgtRect: TGT, dockTarget: "none" })} />,
    );
    expect(container.querySelector(".tl-preview-ghost")).not.toBeNull();
    expect(container.querySelector(".tl-preview-center")).toBeNull();
    expect(container.querySelector(".tl-preview-slot")).toBeNull();
  });

  it("停靠无目标矩形 → 仅 ghost", () => {
    const { container } = render(
      <LayoutPreview {...baseProps({ mode: "docking", dockSrcRect: SRC, dockTarget: "left" })} />,
    );
    expect(container.querySelector(".tl-preview-ghost")).not.toBeNull();
    expect(container.querySelector(".tl-preview-slot")).toBeNull();
  });
});

describe("LayoutPreview 自定义插槽(renderPreview 取代默认)", () => {
  const slots: RenderSlots = { renderPreview: () => <i data-testid="custom" /> };

  it("分割/合并/停靠三种模式都委托 renderPreview", () => {
    const renderPreview = vi.fn(() => <i data-testid="custom" />);
    const s: RenderSlots = { renderPreview };

    const split = render(<LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, splitDir: G.AXIS.H, slots: s })} />);
    expect(split.getByTestId("custom")).toBeInTheDocument();
    cleanup();

    const join = render(<LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, tgtRect: TGT, slots: s })} />);
    expect(join.getByTestId("custom")).toBeInTheDocument();
    cleanup();

    const dock = render(<LayoutPreview {...baseProps({
      mode: "docking", dockSrcRect: SRC, dockTgtRect: TGT, dockSlot: G.rect(0.5, 0, 0.6, 0.5), dockTarget: "left", slots: s,
    })} />);
    expect(dock.getByTestId("custom")).toBeInTheDocument();

    expect(renderPreview).toHaveBeenCalledWith(expect.objectContaining({ mode: "split" }));
    expect(renderPreview).toHaveBeenCalledWith(expect.objectContaining({ mode: "join" }));
    expect(renderPreview).toHaveBeenCalledWith(expect.objectContaining({ mode: "dock" }));
  });

  it("默认样式在提供插槽时不渲染", () => {
    const { container } = render(<LayoutPreview {...baseProps({ mode: "corner", srcRect: SRC, tgtRect: TGT, slots })} />);
    expect(container.querySelector(".tl-preview-join")).toBeNull();
  });
});
