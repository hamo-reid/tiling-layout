import { beforeEach, describe, expect, it } from "vitest";
import { computeAllSnapshots, deserializeWorkspaces, serializeWorkspaces, useWorkspaces } from "../src/workspaces";
import { useLayout } from "../src/layoutStore";
import { buildInitialScreen } from "../src/screen";
import { collectSnapshot, SNAPSHOT_VERSION } from "../src/layoutData";

/** 重置为初始单布局(几何/实例/历史全清)，隔离用例间串状态 */
beforeEach(() => {
  useWorkspaces.setState({
    list: [{ id: "layout-1", name: "General" }],
    data: { "layout-1": { snapshot: collectSnapshot(buildInitialScreen()), history: { past: [], future: [] } } },
    activeId: "layout-1",
  });
  useLayout.setState({ screen: buildInitialScreen(), past: [], future: [], mode: "idle" });
});

describe("workspaces 持久化 roundtrip", () => {
  it("serialize → deserialize 保持整个布局集合", () => {
    useWorkspaces.getState().create("L2"); // 现容器应有 2 个布局(默认 + 新)
    const st = useWorkspaces.getState();
    const beforeIds = Object.keys(st.data);
    expect(beforeIds.length).toBeGreaterThanOrEqual(2);

    const json = serializeWorkspaces();
    const parsed = JSON.parse(json) as { list: { name: string }[]; data: Record<string, unknown> };
    expect(parsed.list.map((l) => l.name)).toContain("L2");
    expect(Object.keys(parsed.data).length).toBe(beforeIds.length);

    // 破坏当前集合后再恢复
    useWorkspaces.setState({ list: [{ id: "z", name: "z" }], data: {} as never, activeId: "z" });
    deserializeWorkspaces(json);
    expect(useWorkspaces.getState().list.map((l) => l.name)).toContain("L2");
    expect(Object.keys(useWorkspaces.getState().data)).toHaveLength(beforeIds.length);
  });

  it("workaround: 时序不再跨用例串状态", () => {
    // 用一次 roundtrip 把 store 重置为初始单布局，避免污染其它测试文件顺序
    const st = useWorkspaces.getState();
    const first = st.list[0].id;
    const json = serializeWorkspaces();
    const one = { list: st.list.slice(0, 1), data: { [first]: st.data[first] }, activeId: first };
    deserializeWorkspaces(JSON.stringify(one));
    expect(Object.keys(useWorkspaces.getState().data)).toHaveLength(1);
    void json;
  });
});

describe("computeAllSnapshots 全布局快照", () => {
  it("返回每个布局 id → 快照 JSON 的映射", () => {
    useWorkspaces.getState().create("L2");
    const all = computeAllSnapshots();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(2);
    expect(all[useWorkspaces.getState().activeId]).toContain(`"v":${SNAPSHOT_VERSION}`);
    useWorkspaces.setState({ list: [{ id: "layout-1", name: "General" }], data: { "layout-1": useWorkspaces.getState().data["layout-1"] }, activeId: "layout-1" });
  });
});

describe("deserializeWorkspaces 健壮性", () => {
  it("空 list 抛错", () => {
    expect(() => deserializeWorkspaces(JSON.stringify({ v: 1, list: [], data: {}, activeId: "x" }))).toThrow();
  });
  it("activeId 不存在但 list 有兜底 → 回到首个布局", () => {
    const st = useWorkspaces.getState();
    const first = st.list[0].id;
    const bad = JSON.stringify({ v: 1, list: [{ id: "a", name: "A" }], data: { a: st.data[first] }, activeId: "ghost" });
    deserializeWorkspaces(bad);
    expect(useWorkspaces.getState().activeId).toBe("a");
  });
  it("list 非空但首个布局无数据也抛错", () => {
    expect(() => deserializeWorkspaces(JSON.stringify({ v: 1, list: [{ id: "a", name: "A" }], data: {}, activeId: "ghost" }))).toThrow();
  });
  it("history 缺失时归一为空栈(undo 不再踩 undefined 崩溃)", () => {
    const bad = JSON.stringify({
      v: 1,
      list: [{ id: "a", name: "A" }],
      data: { a: { snapshot: collectSnapshot(buildInitialScreen()) } }, // 无 history 字段
      activeId: "a",
    });
    deserializeWorkspaces(bad);
    expect(useWorkspaces.getState().activeId).toBe("a");
    expect(useLayout.getState().past).toEqual([]);
    expect(useLayout.getState().future).toEqual([]);
    expect(() => useLayout.getState().undo()).not.toThrow();
  });
});

describe("workspaces 布局切换与删除", () => {
  it("switchTo 隔离各布局几何与历史", () => {
    // 注意：create 返回值取新 id，不可复用 create 前的 st.activeId(旧 state 引用)
    const id2 = useWorkspaces.getState().create("L2");
    // 在 L2 上做一次分割(4 区)
    const vp = useLayout.getState().screen.areas[0].id;
    useLayout.getState().beginCorner(vp, { x: 0.3, y: 0.5 }, false);
    useLayout.getState().cornerMove(0.2, 0.5);
    useLayout.getState().cornerUp();
    expect(useLayout.getState().screen.areas.length).toBe(4);

    useWorkspaces.getState().switchTo("layout-1");
    expect(useWorkspaces.getState().activeId).toBe("layout-1");
    expect(useLayout.getState().screen.areas.length).toBe(3); // 种子布局仍 3 区

    useWorkspaces.getState().switchTo(id2);
    expect(useLayout.getState().screen.areas.length).toBe(4); // 回 L2 仍是 4 区
  });
  it("remove 删除非活跃布局", () => {
    useWorkspaces.getState().create("L2");
    const before = useWorkspaces.getState().list.length;
    useWorkspaces.getState().remove("layout-1");
    expect(useWorkspaces.getState().list.length).toBe(before - 1);
    expect(useWorkspaces.getState().data["layout-1"]).toBeUndefined();
  });
  it("remove 当前活跃 → 切到首个其它布局并删除", () => {
    useWorkspaces.getState().create("L2");
    const cur = useWorkspaces.getState().activeId; // layout-2
    useWorkspaces.getState().remove(cur);
    const fin = useWorkspaces.getState();
    expect(fin.list.length).toBe(1);
    expect(fin.list[0].id).toBe("layout-1");
    expect(fin.data[cur]).toBeUndefined();
  });
  it("只剩一个布局时 remove 无操作", () => {
    const st = useWorkspaces.getState();
    const only = st.list[0].id;
    st.remove(only);
    expect(useWorkspaces.getState().list.length).toBe(1);
  });
});