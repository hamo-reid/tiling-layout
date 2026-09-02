import * as G from "./geometry";
import { collectSnapshot, migrateSnapshot } from "./layoutData";
import type { AreaSnap, LayoutMeta, LayoutSnapshot } from "./layoutData";
import { useLayout } from "./layoutStore";
import { getContentDef, registerContent } from "./registry";
import type { ContentDef } from "./registry";
import { useAreaState } from "./areaStore";
import type { AreaState } from "./areaStore";
import { useScene } from "./sceneStore";
import type { MeshObject } from "./sceneStore";
import { buildInitialScreen } from "./screen";
import { refreshSeedIfPristine } from "./workspaces";

/**
 * initialLayout — 声明式初始布局引导层。
 *
 * 默认布局在 import 时被 buildInitialScreen 固化(layoutStore.ts:189)，公开面没有
 * 注入点，过去只能靠「模块顶层 restore hack」。本层提供一站式声明式入口：
 *   - 布局结构:手写 rect 数组、LayoutSnapshot、或几何 Screen 均可
 *   - 区域内容:字符串(已注册类型)或内联 ContentDef(校验通过后自动 registerContent)
 * 物化后走统一的 migrateSnapshot → restore 事务链，快照 schema 与状态机零改动；
 * 若种子布局(layout-1)仍是原始默认，一并刷新其容器快照，避免切换布局回退默认。
 *
 * 页面级语义:布局替换只发生一次(模块级 bootstrapped 标记)——重挂载组件、多实例
 * 共存都不会重复 install 覆盖用户已改的数据；「是否仍是最初状态」由 isPristineScreen
 * 判定(几何 + 实例状态仅 defaults 注入 + 共享数据)。
 * @category 渲染与主题
 */

/** 声明式初始区域：rect 为 [0,1]×[0,1] 归一化比例矩形
 * @category 渲染与主题
 */
export interface InitialArea {
  /** 区域 id(缺省自动分配，避开所有显式 id) */
  id?: number;
  /** [xmin, ymin, xmax, ymax] 归一化比例矩形 */
  rect: [number, number, number, number];
  /** 区域内容：已注册的类型名，或内联内容定义(自动注册，type 即最终 contentType，
   *  单一命名空间——areaStates/areaInstances/状态栏均按 type 寻址)；
   *  缺省 "general" */
  content?: string | ContentDef;
}

/** 宽松快照输入：手写时可省 v/areaStates/shared(install 内部 migrate 归一与兜底)。
 *  规范化快照 LayoutSnapshot 结构兼容(必填字段可赋给可选)。 */
export interface InitialSnapshot {
  v?: number;
  areas: AreaSnap[];
  areaStates?: Record<number, Record<string, AreaState>>;
  shared?: Partial<MeshObject>;
  meta?: LayoutMeta;
}

/** 初始布局输入：宽松快照 | Screen | 声明式 areas 列表
 * @category 渲染与主题
 */
export type InitialLayout =
  | InitialSnapshot
  | G.Screen
  | { areas: InitialArea[]; shared?: Partial<MeshObject> };

/** 判定 Screen(带 _id 字段) */
function isScreen(x: unknown): x is G.Screen {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "_id" in x;
}
/** 判定快照(带 v 字段) */
function isSnapshot(x: unknown): x is LayoutSnapshot {
  return typeof x === "object" && x !== null && !Array.isArray(x) && "v" in x;
}

/** 内容解析：内联定义**暂缓注册**(等几何校验通过，失败路径零副作用)；
 *  返回最终 contentType 与待注册定义 */
function resolveContent(c: string | ContentDef | undefined): { type: string; def: ContentDef | null } {
  if (c === undefined) return { type: "general", def: null };
  if (typeof c === "string") return { type: c, def: null };
  return { type: c.type, def: c };
}

/** 声明式 areas → 快照对象(尚未 migrate 校验；重复 id 等交给 migrateSnapshot fail-closed)。
 *  id 两遍分配：先收集全部显式 id，再为缺省项从小到大分配——不依赖条目顺序。 */
function buildSnapshotFromAreas(
  entries: InitialArea[],
  shared?: Partial<MeshObject>,
): { snap: LayoutSnapshot; defs: ContentDef[] } {
  const defs: ContentDef[] = [];
  const used = new Set<number>();
  for (const it of entries) if (it.id !== undefined) used.add(it.id);
  let nextId = 1;
  const areas: AreaSnap[] = [];
  for (const it of entries) {
    const r = resolveContent(it.content);
    if (r.def) defs.push(r.def);
    let id = it.id;
    if (id === undefined) {
      while (used.has(nextId)) nextId++;
      used.add(nextId);
      id = nextId;
    }
    areas.push({ id, contentType: r.type, rect: it.rect });
  }
  return {
    snap: { v: 1, areas, areaStates: {}, shared: { x: shared?.x ?? 0, rot: shared?.rot ?? 0 } },
    defs,
  };
}

/** 归一输入为快照对象(未校验)与待注册的内联定义 */
function toSnapshotWithDefs(layout: InitialLayout): { snap: unknown; defs: ContentDef[] } {
  if (isSnapshot(layout)) return { snap: layout, defs: [] };
  if (isScreen(layout)) return { snap: collectSnapshot(layout), defs: [] };
  return buildSnapshotFromAreas(layout.areas, layout.shared);
}

/** 模块级「已引导」标记：初始布局替换是页面级语义，只发生一次。
 *  重挂载组件、多实例共存、程序化 install 后都不会重复覆盖用户已改的数据。 */
let bootstrapped = false;
/** 是否已安装过初始布局(页面级)
 * @category 渲染与主题
 */
export function isLayoutBootstrapped(): boolean {
  return bootstrapped;
}

/** @internal 重置页面级已引导标记(测试/HMR 隔离用) */
export function resetLayoutBootstrap(): void {
  bootstrapped = false;
}

/** 槽位是否只含「defaults 自动注入」的值：任何键不在 defaults 里、
 *  或值不等于 defaults(用户 setState 改过)即视为被用户碰过。 */
function isDefaultsOnly(map: Record<number, Record<string, AreaState>>): boolean {
  for (const slots of Object.values(map)) {
    for (const [type, state] of Object.entries(slots)) {
      const defaults = (getContentDef(type)?.defaults ?? {}) as Record<string, unknown>;
      for (const k of Object.keys(state)) {
        if (!(k in defaults) || state[k] !== defaults[k]) return false;
      }
    }
  }
  return true;
}

/** 当前 store 是否仍为「未被动过」的初始状态：
 *   - 几何/类型等于 buildInitialScreen 默认三区(按 id 对齐)
 *   - 实例状态只含 defaults 自动注入(用户 setState 改过即非 pristine)
 *   - 共享数据仍为默认 {x:0,rot:0}
 *  LayoutViewDom 的 initialLayout prop 以此判断是否该应用——交互过(改内容/场景)或
 *  几何已变时重挂载组件不会把用户数据冲回初始布局。 */
export function isPristineScreen(): boolean {
  const s = useLayout.getState().screen;
  const def = buildInitialScreen();
  if (s.areas.length !== def.areas.length) return false;
  for (const a of def.areas) {
    const b = s.areas.find((x) => x.id === a.id);
    if (!b || b.contentType !== a.contentType) return false;
    const r = a.rect, r2 = b.rect;
    if (r.xmin !== r2.xmin || r.ymin !== r2.ymin || r.xmax !== r2.xmax || r.ymax !== r2.ymax) return false;
  }
  if (!isDefaultsOnly(useAreaState.getState().map)) return false;
  const mesh = useScene.getState().mesh;
  if (mesh.x !== 0 || mesh.rot !== 0) return false;
  return true;
}

/**
 * 安装初始布局：物化(内联内容**校验通过后**自动注册)→ migrateSnapshot 校验归一 →
 * restore 落地(重建 screen 并同步 areaStore/sceneStore)→ 种子 layout-1 若仍为原始
 * 默认则一并刷新 → 置页面级已引导标记。
 * 无效输入(几何非法)不抛错：降级 console.warn 并返回 null，现有状态与注册表均不受影响。
 * @param layout 声明式初始布局(见 {@link InitialLayout})
 * @returns 已应用的快照；无效输入返回 null
 * @category 渲染与主题
 */
export function installInitialLayout(layout: InitialLayout): LayoutSnapshot | null {
  let snap: LayoutSnapshot;
  const defs: ContentDef[] = [];
  try {
    const r = toSnapshotWithDefs(layout);
    // 校验分级：几何非法(越界/重叠/id 重复/未来版本)抛错，未铺满舞台仅 warn 放行。
    // 校验在注册之前——失败路径不产生 registerContent 全局副作用
    snap = migrateSnapshot(r.snap);
    defs.push(...r.defs);
  } catch (err) {
    console.warn(`[tiling-layout] initialLayout 无效，已忽略:`, err);
    return null;
  }
  for (const d of defs) registerContent(d);   // 校验通过才注册(upsert 幂等)
  useLayout.getState().restore(snap);          // 重建 screen + 同步 areaStore/sceneStore，清手势残留，不进 undo
  refreshSeedIfPristine(snap);                 // 种子布局仍是默认时同步容器快照
  bootstrapped = true;
  return snap;
}
