import * as G from "./geometry";
import { useAreaState } from "./areaStore";
import type { AreaState } from "./areaStore";
import { useScene } from "./sceneStore";
import type { MeshObject } from "./sceneStore";

/**
 * layoutData — 布局库的数据层：把「几何平铺 + 每区域实例状态 + 共享数据」统一成一份
 * 可序列化快照。用途：
 *   - 持久化(保存/载入工作区)
 *   - undo/redo(快照栈)
 *   - 与 UI 解耦的数据交换格式
 *
 * 快照格式(v1)：几何只存区域矩形，分界线由相邻关系推导，不持久化。
 * @category 快照与序列化
 */

export interface AreaSnap {
  id: number;
  contentType: string;
  /** [xmin, ymin, xmax, ymax] 归一化比例矩形 */
  rect: [number, number, number, number];
}
export interface LayoutMeta { name?: string; savedAt?: number; }
export interface LayoutSnapshot {
  v: number;                // 格式版本(由 migrateSnapshot 归一)
  areas: AreaSnap[];
  /** map[areaId][contentType] → 实例状态(按内容类型分槽) */
  areaStates: Record<number, Record<string, AreaState>>;
  shared: MeshObject;
  meta?: LayoutMeta;
}

export const SNAPSHOT_VERSION = 1;

const isPlainObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** 校验一条区域条目为 [xmin,ymin,xmax,ymax]；几何非法直接抛错。 */
function normalizeAreaEntry(e: unknown): AreaSnap {
  const a = e as Partial<AreaSnap> & Record<string, unknown>;
  if (typeof a.id !== "number" || typeof a.contentType !== "string") {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  if (!Array.isArray(a.rect)) {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  const r = a.rect;
  if (r.length < 4 || !r.every(Number.isFinite)) {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  const [xmin, ymin, xmax, ymax] = r;
  if (!(xmax - xmin > 0) || !(ymax - ymin > 0)) {
    throw new Error(`无效的区域矩形(id=${String(a.id)})`);
  }
  return { id: a.id, contentType: a.contentType, rect: [xmin, ymin, xmax, ymax] };
}

/** 将任意快照归一为当前格式：校验结构并固定 v 字段。
 *  几何(areas)是重建 Screen 的承重数据，条目级字段缺失/非法直接抛错拒绝；
 *  areaStates 是实例状态(非承重)，仅剔除脏槽位、合法条目按引用透传。
 *  @param raw 任意来源的快照数据(JSON.parse 结果即可)，就地归一并返回同一对象
 *  @returns 结构合法、v 字段固定为当前版本的快照
 *  @throws 几何数据缺失/非法时抛错
 * @category 快照与序列化
 */
export function migrateSnapshot(raw: unknown): LayoutSnapshot {
  if (!isPlainObj(raw)) throw new Error("无效的布局数据");
  const s = raw as Partial<LayoutSnapshot> & Record<string, unknown>;
  if (!Array.isArray(s.areas)) {
    throw new Error("无效的布局数据");
  }
  s.areas = s.areas.map(normalizeAreaEntry);

  s.areaStates ??= {};
  for (const [k, slots] of Object.entries(s.areaStates)) {
    if (!isPlainObj(slots)) delete (s.areaStates as Record<string, unknown>)[k];
  }
  s.v = SNAPSHOT_VERSION;
  return s as LayoutSnapshot;
}

/** 采集当前状态 → 快照(原始数据，非 JSON 字符串)
 *  @param screen 要采集的屏幕(通常为 useLayout 的 screen)
 *  @returns 含几何/实例状态/共享数据的完整快照 */
export function collectSnapshot(screen: G.Screen): LayoutSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    meta: { name: "未命名布局", savedAt: Date.now() },
    areas: screen.areas.map((a) => ({
      id: a.id,
      contentType: a.contentType,
      rect: [a.rect.xmin, a.rect.ymin, a.rect.xmax, a.rect.ymax] as [number, number, number, number],
    })),
    areaStates: { ...useAreaState.getState().map },
    shared: useScene.getState().mesh,
  };
}

/** 应用快照 → 重建全新 Screen，并同步 areaStore / sceneStore。返回新 screen。
 *  @param snap 经 migrateSnapshot 校验过的快照
 *  @returns 重建的屏幕(保留原区域 id) */
export function applySnapshot(snap: LayoutSnapshot): G.Screen {
  const s = G.createScreen();
  // 新 id 从「恢复的最大 id + 1」起步(并保底独立命名空间)，避免与恢复的旧 id 冲突
  const maxId = snap.areas.reduce((m, x) => Math.max(m, x.id), 0);
  s._id = Math.max(200000, maxId + 1);

  // ★ 恢复原始 id：id 是 area 跨引用的稳定键(areaStore 实例状态/历史栈都按它寻址)
  for (const a of snap.areas) {
    const area = G.addArea(s, G.rect(...a.rect), a.contentType);
    area.id = a.id;
  }

  useAreaState.setState({ map: { ...snap.areaStates } });
  useScene.setState({ mesh: { x: snap.shared?.x ?? 0, rot: snap.shared?.rot ?? 0 } }); // shared 缺字段时以默认值兜底
  return s;
}

/** 便捷：当前 total screen 直接取数并序列化为字符串
 *  @param screen 要序列化的屏幕
 *  @returns 快照 JSON 字符串(可直接持久化或经 restore 载回)
 * @category 快照与序列化
 */
export function serializeLayout(screen: G.Screen): string {
  return JSON.stringify(collectSnapshot(screen));
}
