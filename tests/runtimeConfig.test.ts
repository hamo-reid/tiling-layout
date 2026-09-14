import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_DEFAULTS, configureRuntime, runtime } from "../src/runtimeConfig";

describe("行为参数(runtimeConfig)", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("默认值 = 历史硬编码常量(零回归)", () => {
    const r = runtime();
    expect(r.dockCenter).toBe(0.25);
    expect(r.dockSnap).toEqual([0.25, 0.33, 0.5, 0.66, 0.75]);
    expect(r.minAreaW).toBe(0.06);
    expect(r.minAreaH).toBe(0.06);
    expect(r.cornerArm).toBe(0.01);
    expect(r.hitTolerance).toBe(0.005);
    expect(RUNTIME_DEFAULTS.dockCenter).toBe(0.25);
  });

  it("partial 覆盖 + 还原函数回退", () => {
    restore = configureRuntime({ dockCenter: 0.4, minAreaW: 0.1 });
    expect(runtime().dockCenter).toBe(0.4);
    expect(runtime().minAreaW).toBe(0.1);
    expect(runtime().minAreaH).toBe(0.06); // 未覆盖保持
    restore();
    restore = null;
    expect(runtime().dockCenter).toBe(0.25);
    expect(runtime().minAreaW).toBe(0.06);
  });

  it("dockSnap 去重升序拷贝, 不改调用方数组", () => {
    const snap = [0.5, 0.25, 0.5, 0.33];
    restore = configureRuntime({ dockSnap: snap });
    expect(runtime().dockSnap).toEqual([0.25, 0.33, 0.5]);
    expect(snap).toEqual([0.5, 0.25, 0.5, 0.33]);
  });

  it("非法值逐键忽略, 不阻断其余键", () => {
    restore = configureRuntime({
      dockCenter: Number.NaN,
      dockSnap: [],
      minAreaW: -1,
      minAreaH: 0.7, // ≥0.5 越界
      cornerArm: 0,
      hitTolerance: Number.POSITIVE_INFINITY,
    });
    expect(runtime().dockCenter).toBe(0.25);
    expect(runtime().dockSnap).toEqual([0.25, 0.33, 0.5, 0.66, 0.75]);
    expect(runtime().minAreaW).toBe(0.06);
    expect(runtime().minAreaH).toBe(0.06);
    expect(runtime().cornerArm).toBe(0.01);
    expect(runtime().hitTolerance).toBe(0.005);
  });

  it("嵌套 configure 按栈还原", () => {
    const r1 = configureRuntime({ dockCenter: 0.3 });
    const r2 = configureRuntime({ dockCenter: 0.4 });
    expect(runtime().dockCenter).toBe(0.4);
    r2();
    expect(runtime().dockCenter).toBe(0.3);
    r1();
    expect(runtime().dockCenter).toBe(0.25);
  });
});
