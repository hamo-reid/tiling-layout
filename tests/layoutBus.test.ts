import { describe, expect, it } from "vitest";
import { layoutBus } from "../src/layoutBus";
import { useScene } from "../src/sceneStore";
import { setAreaState } from "../src/areaStore";
import { useLayout } from "../src/layoutStore";

describe("layoutBus 订阅回调", () => {
  it("共享数据变化触发；同一状态重复去重不触发", () => {
    let count = 0;
    const un = layoutBus.onChange(() => { count++; });
    useScene.setState((s) => ({ mesh: { x: s.mesh.x + 1, rot: 0 } }));
    expect(count).toBeGreaterThan(0);
    const n0 = count;
    useScene.setState((s) => ({ mesh: { x: s.mesh.x, rot: 0 } })); // 指纹不变 → 去重
    expect(count).toBe(n0);
    un();
  });

  it("实例状态变化触发；取消订阅后不再触发", () => {
    const a = useLayout.getState().screen.areas[0];
    let count = 0;
    const un = layoutBus.onChange(() => { count++; });
    setAreaState(a.id, "viewport", { view: { rot: 7, zoom: 1 } });
    expect(count).toBeGreaterThan(0);
    const n1 = count;
    un();
    setAreaState(a.id, "viewport", { view: { rot: 8, zoom: 1 } });
    expect(count).toBe(n1);
  });
});