// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useLayoutData } from "../src/useLayoutData";
import { useLayout } from "../src/layoutStore";
import { useWorkspaces } from "../src/workspaces";
import { useScene } from "../src/sceneStore";
import { useAreaState } from "../src/areaStore";
import { buildInitialScreen } from "../src/screen";
import { collectSnapshot, SNAPSHOT_VERSION } from "../src/layoutData";

beforeEach(() => {
  useWorkspaces.setState({
    list: [{ id: "layout-1", name: "General" }],
    data: { "layout-1": { snapshot: collectSnapshot(buildInitialScreen()), history: { past: [], future: [] } } },
    activeId: "layout-1",
  });
  useLayout.setState({ screen: buildInitialScreen(), past: [], future: [], mode: "idle" });
  useScene.setState({ mesh: { x: 0, rot: 0 } });
  useAreaState.setState({ map: {} });
  cleanup();
});

describe("useLayoutData 门面", () => {
  it("暴露多布局/数据三视图/序列化 API", () => {
    const { result } = renderHook(() => useLayoutData());
    expect(result.current.activeId).toBe("layout-1");
    expect(result.current.layouts).toHaveLength(1);
    expect(result.current.screen.areas).toHaveLength(3);
    expect(result.current.areaStates).toEqual({});
    expect(result.current.shared).toEqual({ x: 0, rot: 0 });
    expect(result.current.serialize()).toContain(`"v":${SNAPSHOT_VERSION}`);
  });
  it("操作：setAreaState / moveMesh / createLayout / switchTo", () => {
    const { result } = renderHook(() => useLayoutData());
    const vp = result.current.screen.areas[0].id;
    act(() => {
      result.current.setAreaState(vp, "viewport", { view: { rot: 9 } });
      result.current.moveMesh(2);
      result.current.createLayout("L2");
    });
    expect(useAreaState.getState().map[vp]).toEqual({ viewport: { view: { rot: 9 } } });
    expect(useScene.getState().mesh.x).toBe(2);
    expect(useWorkspaces.getState().list).toHaveLength(2);

    act(() => { result.current.switchTo("layout-1"); });
    expect(useWorkspaces.getState().activeId).toBe("layout-1");
  });
  it("removeLayout 删除布局", () => {
    const { result } = renderHook(() => useLayoutData());
    act(() => { result.current.createLayout("L2"); });
    const id2 = useWorkspaces.getState().activeId;
    act(() => { result.current.removeLayout(id2); });
    expect(useWorkspaces.getState().list).toHaveLength(1);
  });
  it("undo/redo 走历史栈", () => {
    const { result } = renderHook(() => useLayoutData());
    const vp = useLayout.getState().screen.areas[0].id;
    act(() => {
      useLayout.getState().beginCorner(vp, { x: 0.3, y: 0.5 }, false);
      useLayout.getState().cornerMove(0.2, 0.5);
      useLayout.getState().cornerUp();
    });
    expect(useLayout.getState().screen.areas).toHaveLength(4);

    act(() => { result.current.undo(); });
    expect(useLayout.getState().screen.areas).toHaveLength(3);

    act(() => { result.current.redo(); });
    expect(useLayout.getState().screen.areas).toHaveLength(4);
  });
  it("onChange 订阅实质数据变化(微任务折叠后异步投递)", async () => {
    const { result } = renderHook(() => useLayoutData());
    let count = 0;
    act(() => { result.current.onChange(() => { count++; }); });
    act(() => { result.current.moveMesh(1); });
    await act(async () => { await new Promise<void>((r) => queueMicrotask(() => r())); });
    expect(count).toBeGreaterThan(0);
  });
});
