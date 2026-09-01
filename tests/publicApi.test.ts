import { describe, expect, it } from "vitest";
import * as api from "../src/public-api";

/**
 * 公共 API 冒烟测试：公开面是库的契约，任何"应导出而未导出"(意外收窄)
 * 或"@internal 意外泄漏"(意外放宽)都在这里显式锁定。
 */

describe("public-api 公开面契约", () => {
  it("关键值导出存在且非空", () => {
    for (const name of [
      // 几何
      "createScreen", "addArea", "rect", "withRect", "findAreaAtXY", "findEdgeAtPos",
      "split", "splitCoord", "joinAreas", "deriveEdges", "connectedSegs",
      "edgeFamilyAreas", "snapCoord", "AXIS", "MIN_AREA_W", "MIN_AREA_H",
      // 数据 / 总线 / 状态机
      "collectSnapshot", "applySnapshot", "migrateSnapshot", "serializeLayout", "SNAPSHOT_VERSION",
      "layoutBus", "useLayout", "useLayoutData",
      // 工作区
      "useWorkspaces", "serializeWorkspaces", "deserializeWorkspaces", "WORKSPACES_KEY",
      // 渲染 / 主题
      "Content", "registerContent", "getContentTitle", "LayoutViewDom", "LayoutProvider",
      "configToCssVars", "SPACING_DEFAULTS", "SIZING_DEFAULTS", "buildInitialScreen",
    ] as (keyof typeof api)[]) {
      expect(api[name], `导出 ${name} 缺失`).toBeDefined();
    }
  });

  it("@internal 符号不进入公开面(clearContentRegistry 等)", () => {
    expect("clearContentRegistry" in api).toBe(false);
    expect("clearAreaInstances" in api).toBe(false);
    expect("getContentDef" in api).toBe(false);
    expect("registerAreaInstance" in api).toBe(false);
  });

  it("几何冒烟：rect/withRect 派生字段与有限值校验", () => {
    const r = api.rect(0, 0, 1, 1);
    expect(r.width).toBe(1);
    const r2 = api.withRect(r, { xmax: 0.5 });
    expect(r2.width).toBe(0.5);
    expect(() => api.rect(0, 0, Number.NaN, 1)).toThrow();
  });

  it("快照冒烟：合法快照通过迁移，越界几何被拒绝", () => {
    const snap = api.collectSnapshot(api.buildInitialScreen());
    expect(api.migrateSnapshot(snap).areas).toHaveLength(3);
    expect(() => api.migrateSnapshot({
      v: 1,
      areas: [{ id: 1, contentType: "x", rect: [0.5, 0.5, 2, 2] }], // 越出 [0,1]
    })).toThrow();
  });
});
