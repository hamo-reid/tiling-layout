import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAreaInstances,
  getAreaComponent,
  getComponentsByType,
  registerAreaInstance,
  unregisterAreaInstance,
} from "../src/areaInstances";

const fakeEl = () => ({}) as HTMLElement;

describe("areaInstances 存活组件注册表", () => {
  beforeEach(() => clearAreaInstances());

  it("注册后可按 areaId 查到；未注册返回 null", () => {
    expect(getAreaComponent(1)).toBeNull();
    registerAreaInstance({ areaId: 1, contentType: "viewport", el: fakeEl() });
    const c = getAreaComponent(1);
    expect(c?.contentType).toBe("viewport");
    expect(c?.el).toBeTruthy();
  });

  it("卸载后查询不到", () => {
    registerAreaInstance({ areaId: 2, contentType: "outline", el: fakeEl() });
    unregisterAreaInstance(2);
    expect(getAreaComponent(2)).toBeNull();
  });

  it("按 contentType 过滤出存活组件，按 areaId 升序", () => {
    registerAreaInstance({ areaId: 3, contentType: "viewport", el: fakeEl() });
    registerAreaInstance({ areaId: 1, contentType: "viewport", el: fakeEl() });
    registerAreaInstance({ areaId: 2, contentType: "properties", el: fakeEl() });
    const v = getComponentsByType("viewport");
    expect(v.map((c) => c.areaId)).toEqual([1, 3]);
    expect(v.every((c) => c.contentType === "viewport")).toBe(true);
  });

  it("同 id 重复注册被覆盖(挂载迁移场景)", () => {
    const elA = fakeEl(), elB = fakeEl();
    registerAreaInstance({ areaId: 5, contentType: "viewport", el: elA });
    registerAreaInstance({ areaId: 5, contentType: "general", el: elB });
    expect(getAreaComponent(5)?.el).toBe(elB);
    expect(getAreaComponent(5)?.contentType).toBe("general");
  });
});
