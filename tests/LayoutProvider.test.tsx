// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  it("无 config 时使用默认值(零回归)", () => {
    const { container } = render(<LayoutProvider><span>x</span></LayoutProvider>);
    const wrap = container.firstChild as HTMLElement;
    expect(wrap.style.getPropertyValue("--tl-region-gap")).toBe("2px");
    expect(wrap.style.getPropertyValue("--tl-header-h")).toBe("26px");
    expect(wrap.style.getPropertyValue("--tl-corner")).toBe("14px");
  });
  it("colorMode 写入 documentElement[data-theme]", () => {
    render(<LayoutProvider config={{ colorMode: "dark" }}><div /></LayoutProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("colorMode system 清空 data-theme", () => {
    document.documentElement.dataset.theme = "light";
    render(<LayoutProvider config={{ colorMode: "system" }}><div /></LayoutProvider>);
    expect(document.documentElement.dataset.theme).toBe("");
  });
});
