import { beforeEach, describe, expect, it, vi } from "vitest";
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

  it("反序列化后新建布局不复用已恢复的 id(seq 与 layout-N 对齐)", () => {
    // 复现审计缺陷：建 layout-2 → 落盘 → 「刷新页面」(反序列化恢复) → 点「＋」
    useWorkspaces.getState().create("L2"); // layout-2
    const json = serializeWorkspaces();
    const restoredData = JSON.parse(json).data;
    deserializeWorkspaces(json);           // 模拟刷新恢复：模块级 seq 回到 2
    const id = useWorkspaces.getState().create("L3");
    expect(id).toBe("layout-3");           // 若 seq 未同步会生成 layout-2
    // 被恢复的 layout-2 数据完好未被覆盖。savedAt 是"最后保存时间"戳：create 内
    // saveInto 会刷新活跃布局的它(非内容字段，与 layoutBus 指纹排除 savedAt 同理)，
    // 故通配之，其余字段严格比较——否则两次取时跨过毫秒边界时断言随机翻车(慢 CI 必现)
    expect(useWorkspaces.getState().data["layout-2"]).toEqual({
      ...restoredData["layout-2"],
      snapshot: {
        ...restoredData["layout-2"].snapshot,
        meta: { ...restoredData["layout-2"].snapshot.meta, savedAt: expect.any(Number) },
      },
    });
    expect(useWorkspaces.getState().list.filter((l) => l.id === "layout-2")).toHaveLength(1);
  });
  it("幽灵布局(list 有 id 无 data)被剔除", () => {
    const st = useWorkspaces.getState();
    const first = st.list[0].id;
    deserializeWorkspaces(JSON.stringify({
      v: 1,
      list: [{ id: first, name: "General" }, { id: "ghost", name: "幽灵" }],
      data: { [first]: st.data[first] },
      activeId: first,
    }));
    const fin = useWorkspaces.getState();
    expect(fin.list.map((l) => l.id)).toEqual([first]); // 幽灵条目不在 list
    expect(fin.data["ghost"]).toBeUndefined();
  });
  it("单个布局快照损坏只剔除该布局，其余照常恢复(不连坐整组)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const st = useWorkspaces.getState();
    const first = st.list[0].id;
    const good = st.data[first];
    deserializeWorkspaces(JSON.stringify({
      v: 1,
      list: [{ id: first, name: "General" }, { id: "bad", name: "损坏" }],
      data: {
        [first]: good,
        bad: { snapshot: { v: 1, areas: [{ id: 1, contentType: "x", rect: [0.5, 0.5, 2, 2] }] }, history: { past: [], future: [] } }, // 越界几何
      },
      activeId: first,
    }));
    const fin = useWorkspaces.getState();
    expect(fin.list.map((l) => l.id)).toEqual([first]); // 损坏布局被剔除
    expect(fin.data[first]).toEqual(good);              // 其余布局完好
    warnSpy.mockRestore();
  });
  it("孤儿容器(有 data 无 list)被剔除", () => {
    const st = useWorkspaces.getState();
    const first = st.list[0].id;
    deserializeWorkspaces(JSON.stringify({
      v: 1,
      list: [{ id: first, name: "General" }],
      data: { [first]: st.data[first], orphan: { snapshot: collectSnapshot(buildInitialScreen()), history: { past: [], future: [] } } },
      activeId: first,
    }));
    expect(Object.keys(useWorkspaces.getState().data)).toEqual([first]);
  });
});

describe("computeAllSnapshots 活跃布局同步", () => {
  it("导出前先把活跃布局实时状态同步进容器(与 serializeWorkspaces 对齐)", () => {
    // 在活跃布局上做一次分割(4 区)，不经 switchTo 落盘
    const vp = useLayout.getState().screen.areas[0].id;
    useLayout.getState().beginCorner(vp, { x: 0.3, y: 0.5 }, false);
    useLayout.getState().cornerMove(0.2, 0.5);
    useLayout.getState().cornerUp();
    const all = computeAllSnapshots();
    const activeSnap = JSON.parse(all[useWorkspaces.getState().activeId]) as { areas: unknown[] };
    expect(activeSnap.areas).toHaveLength(4); // 读到的是实时几何而非容器里的旧 3 区快照
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