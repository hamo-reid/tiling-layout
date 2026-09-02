// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installInitialLayout, isLayoutBootstrapped, isPristineScreen, resetLayoutBootstrap } from "../src/initialLayout";
import { useLayout } from "../src/layoutStore";
import { buildInitialScreen } from "../src/screen";
import { useWorkspaces } from "../src/workspaces";
import { setAreaState, useAreaState } from "../src/areaStore";
import { useScene } from "../src/sceneStore";
import { collectSnapshot } from "../src/layoutData";
import { clearContentRegistry, getContentDef, getContentTitle, registerContent } from "../src/registry";
import * as G from "../src/geometry";

/** 全量重置到「模块刚加载」状态：layoutStore 默认三区、workspaces 种子默认、空实例状态 */
function resetAll() {
  useLayout.setState({
    screen: buildInitialScreen(),
    mode: "idle", status: "",
    cornerStart: { x: 0, y: 0 }, lastPt: { x: 0, y: 0 },
    srcId: null, hoverTId: null, splitDir: null, splitLine: 0, snapped: false, ctrl: false,
    resize: null, dock: null, maximizedId: null,
    past: [], future: [],
  });
  useAreaState.setState({ map: {} });
  useScene.setState({ mesh: { x: 0, rot: 0 } });
  const seedId = "layout-1";
  const seedSnap = collectSnapshot(buildInitialScreen(), "General");
  useWorkspaces.setState({
    list: [{ id: seedId, name: "General" }],
    data: { [seedId]: { snapshot: seedSnap, history: { past: [], future: [] } } },
    activeId: seedId,
  });
  clearContentRegistry();
  resetLayoutBootstrap();
}
beforeEach(resetAll);

describe("installInitialLayout 声明式布局", () => {
  it("手写 areas 替换默认三区(几何+类型落地)", () => {
    const snap = installInitialLayout({
      areas: [
        { id: 1, rect: [0, 0, 0.6, 1], content: "editor" },
        { id: 2, rect: [0.6, 0, 1, 1], content: "outline" },
      ],
    })!;
    expect(snap.areas).toHaveLength(2);
    const s = useLayout.getState().screen;
    expect(s.areas.map((a) => a.contentType)).toEqual(["editor", "outline"]);
    expect(s.areas[0].rect.xmax).toBe(0.6);
  });

  it("id 缺省自动分配且避开已用 id", () => {
    installInitialLayout({
      areas: [
        { id: 3, rect: [0, 0, 0.5, 1], content: "a" },
        { rect: [0.5, 0, 1, 1], content: "b" },
      ],
    });
    const ids = useLayout.getState().screen.areas.map((a) => a.id).sort((x, y) => x - y);
    expect(ids).toEqual([1, 3]); // 自动分配避开已用的 3 → 1
  });

  it("自动分配 id 顺序无关(缺省项避开全部显式 id)", () => {
    installInitialLayout({
      areas: [
        { rect: [0, 0, 0.5, 1] },        // 缺省项写在显式 id 之前
        { id: 1, rect: [0.5, 0, 1, 1] }, // 显式 id=1 → 缺省项避让得 2
      ],
    });
    const ids = useLayout.getState().screen.areas.map((a) => a.id).sort((x, y) => x - y);
    expect(ids).toEqual([1, 2]);
  });

  it("内联 ContentDef 自动注册,type 即唯一身份", () => {
    installInitialLayout({
      areas: [
        { id: 1, rect: [0, 0, 1, 1], content: {
            type: "monitor", title: "监视器", defaults: { zoom: 1 },
            Comp: () => null,
          } },
      ],
    });
    expect(getContentDef("monitor")).not.toBeNull();
    expect(getContentTitle("monitor")).toBe("监视器");
    expect(useLayout.getState().screen.areas[0].contentType).toBe("monitor");
  });

  it("缺省 content 回退 general", () => {
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useLayout.getState().screen.areas[0].contentType).toBe("general");
  });

  it("重复安装幂等(内联定义 upsert 不炸)", () => {
    const def = { type: "x", Comp: () => null };
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1], content: def }] });
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1], content: def }] });
    expect(useLayout.getState().screen.areas).toHaveLength(1);
  });

  it("shared 缺省兜底 {x:0,rot:0}", () => {
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useScene.getState().mesh).toEqual({ x: 0, rot: 0 });
  });

  it("接受 LayoutSnapshot 输入(经 migrate 归一)", () => {
    installInitialLayout({
      v: 1,
      areas: [
        { id: 1, contentType: "general", rect: [0, 0, 0.5, 1] },
        { id: 2, contentType: "general", rect: [0.5, 0, 1, 1] },
      ],
    });
    expect(useLayout.getState().screen.areas).toHaveLength(2);
  });

  it("接受几何 Screen 输入", () => {
    const s = G.createScreen();
    G.addArea(s, G.rect(0, 0, 1, 1), "general");
    installInitialLayout(s);
    expect(useLayout.getState().screen.areas).toHaveLength(1);
  });

  it("无效布局(越界几何)降级 warn 返回 null,现有状态不受影响", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = useLayout.getState().screen.areas.length;
    const ret = installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 2, 1] }] });
    expect(ret).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(useLayout.getState().screen.areas).toHaveLength(before); // 默认三区未动
    warn.mockRestore();
  });

  it("重复 id 亦被 fail-closed 拒绝", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(installInitialLayout({
      areas: [
        { id: 1, rect: [0, 0, 0.5, 1] },
        { id: 1, rect: [0.5, 0, 1, 1] },
      ],
    })).toBeNull();
    warn.mockRestore();
  });

  it("无效布局失败路径不残留 registerContent 副作用(校验先于注册)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installInitialLayout({
      areas: [{ id: 1, rect: [0, 0, 2, 1], content: { type: "ghost", Comp: () => null } }], // 越界几何
    });
    expect(warn).toHaveBeenCalled();
    expect(getContentDef("ghost")).toBeNull(); // 校验失败 → 内联定义未注册
    warn.mockRestore();
  });
});

describe("isPristineScreen", () => {
  it("默认三区为 pristine;restore 过后非 pristine", () => {
    expect(isPristineScreen()).toBe(true);
    useLayout.getState().restore({ v: 1, areas: [{ id: 1, contentType: "general", rect: [0, 0, 1, 1] }] });
    expect(isPristineScreen()).toBe(false);
  });

  it("实例状态只有 defaults 注入时仍 pristine;用户改过值即非", () => {
    registerContent({ type: "editor", defaults: { zoom: 1 }, Comp: () => null });
    setAreaState(1, "editor", { zoom: 1 });   // 值等于 defaults → 视为 Content 自动注入
    expect(isPristineScreen()).toBe(true);
    setAreaState(1, "editor", { zoom: 2 });   // 用户改过 → 非 pristine(重挂载不冲用户内容)
    expect(isPristineScreen()).toBe(false);
  });

  it("shared 非默认(场景旋转)即非 pristine", () => {
    useScene.setState({ mesh: { x: 0, rot: 0.5 } });
    expect(isPristineScreen()).toBe(false);
  });
});

describe("isLayoutBootstrapped 页面级标记", () => {
  it("install 成功置位;reset 复原", () => {
    expect(isLayoutBootstrapped()).toBe(false);
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(isLayoutBootstrapped()).toBe(true);
    resetLayoutBootstrap();
    expect(isLayoutBootstrapped()).toBe(false);
  });

  it("无效布局不置位(失败不算引导过)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 2, 1] }] });
    expect(isLayoutBootstrapped()).toBe(false);
    warn.mockRestore();
  });
});

describe("种子同步 refreshSeedIfPristine", () => {
  it("种子仍是默认时,install 后容器快照同步为新布局(否则 switchTo 回退默认)", () => {
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1], content: "editor" }] });
    const seedSnap = useWorkspaces.getState().data["layout-1"].snapshot;
    expect(seedSnap.areas).toHaveLength(1);
    expect(seedSnap.areas[0].contentType).toBe("editor");
  });

  it("种子已被动过时,install 不动容器", () => {
    useWorkspaces.setState((s) => ({
      data: {
        ...s.data,
        "layout-1": {
          ...s.data["layout-1"],
          snapshot: { v: 1, areas: [{ id: 7, contentType: "x", rect: [0, 0, 1, 1] }], areaStates: {}, shared: { x: 0, rot: 0 } },
        },
      },
    }));
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useWorkspaces.getState().data["layout-1"].snapshot.areas[0].id).toBe(7);
  });

  it("活跃布局非种子时不动容器", () => {
    useWorkspaces.setState((s) => ({
      activeId: "layout-2",
      list: [...s.list, { id: "layout-2", name: "L2" }],
      data: { ...s.data, "layout-2": s.data["layout-1"] },
    }));
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useWorkspaces.getState().data["layout-1"].snapshot.areas).toHaveLength(3); // 仍是默认
  });

  it("种子实例状态非空(用户改过内容)时不动容器", () => {
    useWorkspaces.setState((s) => ({
      data: {
        ...s.data,
        "layout-1": {
          ...s.data["layout-1"],
          snapshot: { ...s.data["layout-1"].snapshot, areaStates: { 1: { editor: { text: "x" } } } },
        },
      },
    }));
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useWorkspaces.getState().data["layout-1"].snapshot.areas).toHaveLength(3); // 有内容 → 视为已动过
  });

  it("种子共享数据非默认(场景旋转过)时不动容器", () => {
    useWorkspaces.setState((s) => ({
      data: {
        ...s.data,
        "layout-1": {
          ...s.data["layout-1"],
          snapshot: { ...s.data["layout-1"].snapshot, shared: { x: 0, rot: 0.5 } },
        },
      },
    }));
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    expect(useWorkspaces.getState().data["layout-1"].snapshot.areas).toHaveLength(3);
  });

  it("install 后 commitHistory → undo 退回初始布局(时序:先 install 再压栈)", () => {
    installInitialLayout({ areas: [{ id: 1, rect: [0, 0, 1, 1] }] });
    useLayout.getState().commitHistory();
    // 模拟用户操作:追加一个区域
    const s = useLayout.getState().screen;
    G.addArea(s, G.rect(0.5, 0, 1, 1), "general");
    useLayout.setState({ screen: { ...s } });
    useLayout.getState().undo();
    expect(useLayout.getState().screen.areas).toHaveLength(1);
  });
});
