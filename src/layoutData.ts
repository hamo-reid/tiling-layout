import * as G from "./geometry";
import { useAreaState } from "./areaStore";
import type { AreaState } from "./areaStore";
import { useScene } from "./sceneStore";
import type { MeshObject } from "./sceneStore";
import { checkTiling, toEntries } from "./invariants";

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

/** 校验一条区域条目为 [xmin,ymin,xmax,ymax]；几何非法直接抛错。
 *  校验内容：id 为非负整数、rect 各分量为有限值、正宽高、坐标位于 [0,1] 舞台内。
 *  几何那部分委托 `invariants.checkTiling`(与命令层同一套容差)，此处只留快照 schema 的形状。 */
function normalizeAreaEntry(e: unknown): AreaSnap {
  const a = e as Partial<AreaSnap> & Record<string, unknown>;
  if (typeof a.id !== "number" || !Number.isInteger(a.id) || a.id < 0 || typeof a.contentType !== "string") {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  if (!Array.isArray(a.rect)) {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  const r = a.rect;
  if (r.length < 4 || !r.every(Number.isFinite)) {
    throw new Error(`无效的区域条目(id=${String(a.id)})`);
  }
  const report = checkTiling([{ id: a.id, rect: r }]);
  if (report.errors.length > 0) throw new Error(report.errors[0]);
  const [xmin, ymin, xmax, ymax] = r;
  return { id: a.id, contentType: a.contentType, rect: [xmin, ymin, xmax, ymax] };
}

/** 校验整份快照的几何：两两不重叠(fail-closed —— 重叠会让 deriveEdges 推导出错误
 *  分界线、命中与拖拽错位，属真实几何损坏)，未铺满单位舞台则降级为警告放行
 *  (满铺是文档不变式而非硬约束：经公开 API addArea 程序化构造部分平铺是合法用法，
 *  docs 教学示例即如此；硬拒绝会造成「自己写的数据自己读不回」，且在 autosave 下被静默剔除)。
 *  两档容差与命令层共用 `invariants.checkTiling`，不另立口径。 */
function assertSnapshotGeometry(areas: AreaSnap[]): void {
  const report = checkTiling(toEntries(areas), { full: "warn" });
  if (report.errors.length > 0) throw new Error(report.errors[0]);
  for (const w of report.warnings) console.warn(`[tiling-layout] ${w}`);
}

/** 将任意快照归一为当前格式：校验结构并固定 v 字段。
 *  几何(areas)是重建 Screen 的承重数据，条目级字段缺失/非法直接抛错拒绝；
 *  areaStates 是实例状态(非承重)，仅剔除脏槽位、合法条目按引用透传。
 *  版本分派：整数值 v 超出当前版本(未来格式)fail-closed 拒绝——静默错读比失败
 *  更危险；缺失/污染(非数字)的 v 归一为当前版本。v1 为初始版本，后续格式演进
 *  在此追加「先迁移到下一版、逐级归一」的迁移阶梯后放行历史版本。
 *  @param raw 任意来源的快照数据(JSON.parse 结果即可)，就地归一并返回同一对象
 *  @returns 结构合法、v 字段固定为当前版本的快照
 *  @throws 几何数据缺失/非法、区域矩形重叠或版本无法识别时抛错；未满铺单位
 *          舞台属可容忍退化，降级为 console.warn 放行(部分平铺可经公开 API 构造)
 * @category 快照与序列化
 */
export function migrateSnapshot(raw: unknown): LayoutSnapshot {
  if (!isPlainObj(raw)) throw new Error("无效的布局数据");
  const s = raw as Partial<LayoutSnapshot> & Record<string, unknown>;
  if (typeof s.v === "number" && Number.isInteger(s.v) && s.v > SNAPSHOT_VERSION) {
    throw new Error(`不支持的快照版本(v=${s.v}，当前最高 ${SNAPSHOT_VERSION})`);
  }
  if (!Array.isArray(s.areas)) {
    throw new Error("无效的布局数据");
  }
  s.areas = s.areas.map(normalizeAreaEntry);
  // 区域 id 是 areaStore 实例状态/历史栈的跨引用稳定键，重复 id 会导致状态串写
  const ids = new Set<number>();
  for (const a of s.areas) {
    if (ids.has(a.id)) throw new Error(`区域 id 重复(id=${a.id})`);
    ids.add(a.id);
  }
  assertSnapshotGeometry(s.areas);

  s.areaStates ??= {};
  for (const [k, slots] of Object.entries(s.areaStates)) {
    if (!isPlainObj(slots)) delete (s.areaStates as Record<string, unknown>)[k];
  }
  s.v = SNAPSHOT_VERSION;
  return s as LayoutSnapshot;
}

/** 采集当前状态 → 快照(原始数据，非 JSON 字符串)
 *  @param screen 要采集的屏幕(通常为 useLayout 的 screen)
 *  @param name 布局名称(写入 meta.name；缺省不写该字段)
 *  @returns 含几何/实例状态/共享数据的完整快照 */
export function collectSnapshot(screen: G.Screen, name?: string): LayoutSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    meta: name === undefined ? { savedAt: Date.now() } : { name, savedAt: Date.now() },
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

  useAreaState.setState({ map: { ...(snap.areaStates ?? {}) } });
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
