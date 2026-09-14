import { describe, expect, it } from "vitest";
import { configToCssVars } from "../src/theme";

/** 断言用视图：configToCssVars 返回 CSSProperties(可进 style)，
 *  测试按 CSS 变量名逐键取值时以字符串 Record 视角读取 */
const asVarMap = (v: Record<string, string>) => v;

describe("主题/间距配置(config), 默认=现状", () => {
  it("不传配置时变量为默认值(零回归)", () => {
    const v = asVarMap(configToCssVars() as Record<string, string>);
    expect(v["--tl-region-gap"]).toBe("2px");
    expect(v["--tl-pad-region"]).toBe("8px");
    expect(v["--tl-outer-gap"]).toBe("0px");
    expect(v["--tl-header-h"]).toBe("26px");
    expect(v["--tl-corner"]).toBe("14px");
    expect(v["--tl-radius"]).toBe("6px");
    expect(v["--tl-splitter"]).toBe("6px");
  });

  it("部分覆盖 merge, 未覆盖项保留默认", () => {
    const v = asVarMap(configToCssVars({
      spacing: { regionGap: 8, outerGap: 16 },
      sizing: { corner: 20, splitter: 10 },
    }) as Record<string, string>);
    expect(v["--tl-region-gap"]).toBe("8px");
    expect(v["--tl-outer-gap"]).toBe("16px");
    expect(v["--tl-corner"]).toBe("20px");
    expect(v["--tl-splitter"]).toBe("10px");
    expect(v["--tl-header-h"]).toBe("26px");   // 未覆盖
    expect(v["--tl-pad-region"]).toBe("8px");  // 未覆盖
    expect(v["--tl-radius"]).toBe("6px");      // 未覆盖
  });

  it("partial 模式只输出显式配置的键", () => {
    const v = asVarMap(configToCssVars({ spacing: { outerGap: 12 } }, { partial: true }) as Record<string, string>);
    expect(v["--tl-outer-gap"]).toBe("12px");
    expect("--tl-region-gap" in v).toBe(false); // 未显式配置 → 不输出
    expect("--tl-splitter" in v).toBe(false);
  });
});
