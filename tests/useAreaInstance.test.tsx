// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useAreaInstance, useAreaState } from "../src/areaStore";

beforeEach(() => useAreaState.setState({ map: {} }));

describe("useAreaInstance", () => {
  it("id 未挂载(undefined):value 为空对象,set 为 no-op", () => {
    const { result } = renderHook(() => useAreaInstance(undefined, "x"));
    expect(result.current.value).toEqual({});
    act(() => result.current.set({ a: 1 }));
    expect(useAreaState.getState().map).toEqual({});
    expect(result.current.value).toEqual({});
  });

  it("id 存在:读写对应槽位", () => {
    const { result } = renderHook(() => useAreaInstance(7, "x"));
    expect(result.current.value).toEqual({});
    act(() => result.current.set({ a: 1 }));
    expect(result.current.value).toEqual({ a: 1 });
    act(() => result.current.set({ b: 2 }));
    expect(result.current.value).toEqual({ a: 1, b: 2 }); // 增量合并
  });
});
