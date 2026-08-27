import { describe, expect, it } from "vitest";
import { applySnapshot, collectSnapshot, migrateSnapshot, serializeLayout, SNAPSHOT_VERSION } from "../src/layoutData";
import { getAreaState, setAreaState } from "../src/areaStore";
import { useScene } from "../src/sceneStore";
import { buildInitialScreen } from "../src/screen";

describe("migrateSnapshot 归一当前格式(v1 矩形)", () => {
  it("合法快照固定为当前版本并透传数据", () => {
    const snap = collectSnapshot(buildInitialScreen());
    const out = migrateSnapshot(snap);
    expect(out.v).toBe(SNAPSHOT_VERSION);
    expect(out.areas.length).toBe(3);
  });
  it("非法数据抛错", () => {
    expect(() => migrateSnapshot({ areas: "bad" })).toThrow();
    expect(() => migrateSnapshot("bad")).toThrow();
  });
  it("条目级字段缺失/非法抛错(几何是承重数据，不允许带病通过)", () => {
    const good = { id: 1, contentType: "general", rect: [0, 0, 1, 1] };
    expect(() => migrateSnapshot({ areas: [{ id: "x", contentType: "g", rect: [] }] })).toThrow();
    expect(() => migrateSnapshot({ areas: [{ ...good, contentType: 42 }] })).toThrow();
    expect(() => migrateSnapshot({ areas: [{ ...good, rect: [0, 0, 1, "x"] }] })).toThrow();
    expect(() => migrateSnapshot({ areas: [{ ...good, rect: [1, 0, 0, 1] }] })).toThrow(); // 倒置矩形
    expect(() => migrateSnapshot({ areas: [good] })).not.toThrow();
  });
  it("非数字 v 覆写为当前版本；areaStates 脏槽位剔除、合法槽位保留", () => {
    const raw = {
      v: "1", // JSON 里被污染成字符串：归一时覆写为当前版本号
      areas: [{ id: 1, contentType: "general", rect: [0, 0, 1, 1] }],
      areaStates: { 1: { general: { k: 1 } }, junk: "bad", 2: null },
    };
    const out = migrateSnapshot(raw);
    expect(out.v).toBe(SNAPSHOT_VERSION);
    expect(out.areaStates[1]).toEqual({ general: { k: 1 } });
    expect(out.areaStates[2]).toBeUndefined();
    expect(out.areaStates).not.toHaveProperty("junk");
  });
  it("缺 areaStates 时补空 map，不产生状态条目", () => {
    const old = {
      v: 1,
      areas: [{ id: 1, contentType: "general", rect: [0, 0, 1, 1] }],
    };
    const out = migrateSnapshot(old);
    expect(out.v).toBe(SNAPSHOT_VERSION);
    expect(out.areaStates).toEqual({});
  });
});

describe("collect/apply 往返保持稳定 id", () => {
  it("区域 id 与实例状态在恢复后仍对应(修复重建 id 漂移)", () => {
    const s = buildInitialScreen();
    const a0 = s.areas[0];
    setAreaState(a0.id, "viewport", { view: { rot: 15, zoom: 1 } });
    useScene.setState({ mesh: { x: 2, rot: 0 } });

    const snap = collectSnapshot(s);
    expect(snap.v).toBe(SNAPSHOT_VERSION);
    expect(snap.areas.every((a) => a.rect.length === 4)).toBe(true);

    const s2 = applySnapshot(snap);
    expect(s2.areas.length).toBe(s.areas.length);
    s2.areas.forEach((a, i) => {
      expect(a.id).toBe(s.areas[i].id);
      expect(a.rect).toEqual(s.areas[i].rect); // 几何逐字段还原
    });
    expect(getAreaState(s2.areas[0].id, "viewport").view).toEqual({ rot: 15, zoom: 1 }); // 稳定 id → 状态跟随
    expect(useScene.getState().mesh.x).toBe(2);
  });
});

describe("serializeLayout 便捷序列化", () => {
  it("输出可解析的 JSON 字符串(含当前版本号)", () => {
    const s = buildInitialScreen();
    const str = serializeLayout(s);
    const parsed = JSON.parse(str);
    expect(parsed.v).toBe(SNAPSHOT_VERSION);
    expect(parsed.areas).toHaveLength(3);
  });
});
