import { beforeEach, describe, expect, it } from "vitest";
import {
  cloneAreaState, getAreaState, hasAreaState, moveAreaState, removeAreaStates, setAreaState, swapAreaState, useAreaState,
} from "../src/areaStore";

beforeEach(() => useAreaState.setState({ map: {} }));

describe("areaStore 双键读写", () => {
  it("getAreaState 缺省返回空对象", () => {
    expect(getAreaState(99, "viewport")).toEqual({});
  });
  it("setAreaState 增量写，未命中键保留", () => {
    setAreaState(1, "viewport", { view: { rot: 15 } });
    setAreaState(1, "viewport", { zoom: 2 });
    expect(getAreaState(1, "viewport")).toEqual({ view: { rot: 15 }, zoom: 2 });
  });
  it("同区域不同类型槽位互不干扰", () => {
    setAreaState(1, "viewport", { view: { rot: 15 } });
    setAreaState(1, "my", { myValue: 42 });
    expect(getAreaState(1, "viewport")).toEqual({ view: { rot: 15 } });
    expect(getAreaState(1, "my")).toEqual({ myValue: 42 });
  });
  it("hasAreaState 区分空槽位与未创建", () => {
    expect(hasAreaState(1, "viewport")).toBe(false);
    setAreaState(1, "viewport", {});
    expect(hasAreaState(1, "viewport")).toBe(true); // 空对象也算"有"
    expect(hasAreaState(1, "my")).toBe(false);
  });
});

describe("areaStore 迁移(外层条目整体操作)", () => {
  it("cloneAreaState 新生区域继承来源全部类型槽位", () => {
    setAreaState(1, "viewport", { view: { rot: 30 } });
    setAreaState(1, "my", { myValue: 1 });
    cloneAreaState(1, 2);
    expect(getAreaState(2, "viewport")).toEqual({ view: { rot: 30 } });
    expect(getAreaState(2, "my")).toEqual({ myValue: 1 });
  });
  it("克隆后写入互不串写(内层槽位不可变替换)", () => {
    setAreaState(1, "viewport", { view: { rot: 30 } });
    cloneAreaState(1, 2);
    setAreaState(2, "viewport", { view: { rot: 90 } });
    expect(getAreaState(1, "viewport")).toEqual({ view: { rot: 30 } });
    expect(getAreaState(2, "viewport")).toEqual({ view: { rot: 90 } });
  });
  it("cloneAreaState 来源无状态 → 目标为空条目", () => {
    cloneAreaState(5, 6);
    expect(getAreaState(6, "viewport")).toEqual({});
  });
  it("swapAreaState 两实例全部槽位互换", () => {
    setAreaState(1, "viewport", { a: 1 });
    setAreaState(2, "my", { b: 2 });
    swapAreaState(1, 2);
    expect(getAreaState(1, "my")).toEqual({ b: 2 });
    expect(getAreaState(2, "viewport")).toEqual({ a: 1 });
  });
  it("swapAreaState 一侧缺省用空对象补位", () => {
    setAreaState(1, "viewport", { a: 1 });
    swapAreaState(1, 2);
    expect(getAreaState(1, "viewport")).toEqual({});
    expect(getAreaState(2, "viewport")).toEqual({ a: 1 });
  });
  it("moveAreaState 状态搬到目标并删除源", () => {
    setAreaState(1, "viewport", { view: { rot: 45 } });
    moveAreaState(1, 3);
    expect(getAreaState(3, "viewport")).toEqual({ view: { rot: 45 } });
    expect(useAreaState.getState().map[1]).toBeUndefined();
  });
  it("removeAreaStates 批量删除", () => {
    setAreaState(1, "viewport", { a: 1 });
    setAreaState(2, "my", { b: 2 });
    setAreaState(3, "viewport", { c: 3 });
    removeAreaStates([1, 3]);
    expect(useAreaState.getState().map).toEqual({ 2: { my: { b: 2 } } });
  });
});
