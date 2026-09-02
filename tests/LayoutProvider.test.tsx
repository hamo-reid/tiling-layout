// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LayoutProvider } from "../src/LayoutProvider";

beforeEach(() => {
  delete document.documentElement.dataset.theme;
  cleanup();
});

describe("LayoutProvider 全局配置", () => {
  it("把 config 展平为 --tl-* CSS 变量作用于容器", () => {
    const { container } = render(
      <LayoutProvider config={{ spacing: { regionGap: 5, padRegion: 10 }, sizing: { headerH: 30, corner: 16, radius: 8 } }}>
        <span>内容</span>
      </LayoutProvider>,
    );
    const wrap = container.firstChild as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("5px");
    expect(wrap.style.getPropertyValue("--tl-pad-region")).toBe("10px");
    expect(wrap.style.getPropertyValue("--tl-header-h")).toBe("30px");
    expect(wrap.style.getPropertyValue("--tl-corner")).toBe("16px");
    expect(wrap.style.getPropertyValue("--tl-radius")).toBe("8px");
    expect(screen.getByText("内容")).toBeInTheDocument();
  });
  it("无 config 时不内联变量(样式由 CSS 兜底,零回归)", () => {
    const { container } = render(<LayoutProvider><span>x</span></LayoutProvider>);
    const wrap = container.firstChild as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("");
    expect(wrap.style.getPropertyValue("--tl-header-h")).toBe("");
  });
  it("partial:只内联显式配置的键,未配置键穿透外层/兜底", () => {
    const { container } = render(<LayoutProvider config={{ spacing: { regionGap: 4 } }}><span>x</span></LayoutProvider>);
    const wrap = container.firstChild as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("4px");
    expect(wrap.style.getPropertyValue("--tl-header-h")).toBe(""); // 未配置 → 不内联
    expect(wrap.style.getPropertyValue("--tl-corner")).toBe("");
  });
  it("colorMode 写入 documentElement[data-theme]", () => {
    render(<LayoutProvider config={{ colorMode: "dark" }}><div /></LayoutProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("colorMode system 移除 data-theme(交由 tokens.css 的 prefers-color-scheme 跟随系统)", () => {
    document.documentElement.dataset.theme = "light";
    render(<LayoutProvider config={{ colorMode: "system" }}><div /></LayoutProvider>);
    // 写空值属性会让 :root:not([data-theme]) 永不匹配 → 系统跟随失效，必须移除
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
  it("卸载时还原进入前的 data-theme(全局副作用可逆)", () => {
    document.documentElement.dataset.theme = "light";
    const { unmount } = render(<LayoutProvider config={{ colorMode: "dark" }}><div /></LayoutProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
    act(() => { unmount(); });
    expect(document.documentElement.dataset.theme).toBe("light"); // 还原而非泄漏
  });
});
