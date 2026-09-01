import { describe, expect, it, vi } from "vitest";
import { layoutBus } from "../src/layoutBus";
import { useScene } from "../src/sceneStore";
import { setAreaState } from "../src/areaStore";
import { useLayout } from "../src/layoutStore";
import { buildInitialScreen } from "../src/screen";
import { useWorkspaces } from "../src/workspaces";

/** 等待微任务折叠：bus 的 emit 经 queueMicrotask 异步投递 */
const flushBus = () => new Promise<void>((r) => queueMicrotask(() => r()));

describe("layoutBus 订阅回调", () => {
  it("共享数据变化触发；同一状态重复去重不触发", async () => {
    let count = 0;
    const un = layoutBus.onChange(() => { count++; });
    useScene.setState((s) => ({ mesh: { x: s.mesh.x + 1, rot: 0 } }));
    await flushBus();
    expect(count).toBeGreaterThan(0);
    const n0 = count;
    useScene.setState((s) => ({ mesh: { x: s.mesh.x, rot: 0 } })); // 指纹不变 → 去重
    await flushBus();
    expect(count).toBe(n0);
    un();
  });

  it("实例状态变化触发；取消订阅后不再触发", async () => {
    const a = useLayout.getState().screen.areas[0];
    let count = 0;
    const un = layoutBus.onChange(() => { count++; });
    setAreaState(a.id, "viewport", { view: { rot: 7, zoom: 1 } });
    await flushBus();
    expect(count).toBeGreaterThan(0);
    const n1 = count;
    un();
    setAreaState(a.id, "viewport", { view: { rot: 8, zoom: 1 } });
    await flushBus();
    expect(count).toBe(n1);
  });

  it("同 tick 的多份 setState 折叠为一次事件(订阅方读到一致终态)", async () => {
    const events: { meshX: number; areas: number }[] = [];
    const un = layoutBus.onChange((evt) => {
      events.push({ meshX: evt.snapshot.shared.x, areas: evt.snapshot.areas.length });
    });
    // 模拟一次操作内的跨 store 多发 setState：场景连续变化两次
    const before = useScene.getState().mesh.x;
    useScene.setState((s) => ({ mesh: { x: s.mesh.x + 1, rot: 0 } }));
    useScene.setState((s) => ({ mesh: { x: s.mesh.x + 1, rot: 0 } }));
    await flushBus();
    expect(events).toHaveLength(1);            // 中间态被折叠
    expect(events[0].meshX).toBe(before + 2);  // 且是终态而非首个中间态
    un();
  });

  it("订阅回调抛错被隔离：其余订阅者与后续事件不受影响", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: number[] = [];
    const unBad = layoutBus.onChange(() => { throw new Error("订阅者内部错误"); });
    const unGood = layoutBus.onChange((evt) => { seen.push(evt.snapshot.shared.rot); });
    useScene.setState((s) => ({ mesh: { x: s.mesh.x, rot: s.mesh.rot + 0.5 } }));
    await flushBus();
    expect(seen).toHaveLength(1);              // 后注册的订阅者仍收到事件
    expect(errSpy).toHaveBeenCalledOnce();     // 异常被记录而非反噬调用方
    // 后续事件继续投递
    useScene.setState((s) => ({ mesh: { x: s.mesh.x, rot: s.mesh.rot + 0.5 } }));
    await flushBus();
    expect(seen).toHaveLength(2);
    unBad();
    unGood();
    errSpy.mockRestore();
  });

  it("几何变更与布局切换都触发事件(携带新 activeId)", async () => {
    const activeIds: string[] = [];
    const un = layoutBus.onChange((evt) => { activeIds.push(evt.activeId); });
    // 几何变更(分割)
    const vp = useLayout.getState().screen.areas[0].id;
    useLayout.getState().beginCorner(vp, { x: 0.3, y: 0.5 }, false);
    useLayout.getState().cornerMove(0.2, 0.5);
    useLayout.getState().cornerUp();
    await flushBus();
    // 布局切换
    const id2 = useWorkspaces.getState().create("L2");
    await flushBus();
    expect(useWorkspaces.getState().activeId).toBe(id2);
    expect(activeIds[activeIds.length - 1]).toBe(id2); // 切换事件携带新 activeId
    // 还原单布局(避免用例间串状态)
    const first = useWorkspaces.getState().list[0].id;
    useWorkspaces.setState({ list: [{ id: first, name: "General" }], data: { [first]: useWorkspaces.getState().data[first] }, activeId: first });
    useLayout.setState({ screen: buildInitialScreen(), past: [], future: [], mode: "idle" });
    un();
  });
});
