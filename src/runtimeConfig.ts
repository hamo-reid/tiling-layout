/**
 * runtimeConfig.ts — 行为参数(非 CSS)的运行时配置。
 *
 * 几何层 / 状态机是模块单例纯逻辑，拿不到 React 上下文；这类"操作手感"参数
 * (停靠热区、槽占比吸附网格、最小区域、角点阈值、命中容差)因此只能全局一份。
 * `LayoutProvider` 会把 `LayoutConfig.interaction` 应用到这里(卸载还原)；
 * 非 React 场景可直接 `configureRuntime()`。视觉类参数(regionGap/splitter 等)
 * 仍走 `theme.ts` 的 `--tl-*` CSS 变量，二者互不混淆。
 *
 * 全部为归一化比例(舞台边长占比)，与几何坐标系一致。
 */

/** 行为参数(全局单例)
 * @category 渲染与主题
 */
export interface RuntimeConfig {
  /** 停靠中心热区半宽：fx/fy ∈ [dockCenter, 1-dockCenter] 判为 center。默认 0.25 */
  dockCenter: number;
  /** 停靠槽占比吸附网格(比例)。默认 [0.25, 0.33, 0.5, 0.66, 0.75] */
  dockSnap: number[];
  /** 区域最小宽度(比例)，分割/停靠不得低于此值。默认 0.06 */
  minAreaW: number;
  /** 区域最小高度(比例)。默认 0.06 */
  minAreaH: number;
  /** 角点手势起步锁定阈值(比例)，拖离角锚点超过此距离才锁定源区。默认 0.01 */
  cornerArm: number;
  /** 分界线命中容差(比例)，供 findEdgeAtPos 等几何查询默认使用。默认 0.005 */
  hitTolerance: number;
}

/** 行为参数默认值(与历史硬编码常量一致，保证零回归)
 * @category 渲染与主题
 */
export const RUNTIME_DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
  dockCenter: 0.25,
  dockSnap: [0.25, 0.33, 0.5, 0.66, 0.75],
  minAreaW: 0.06,
  minAreaH: 0.06,
  cornerArm: 0.01,
  hitTolerance: 0.005,
});

let current: RuntimeConfig = {
  ...RUNTIME_DEFAULTS,
  dockSnap: [...RUNTIME_DEFAULTS.dockSnap],
};

/** 当前行为参数(只读消费；请勿改写返回对象/数组)
 * @category 渲染与主题
 */
export function runtime(): RuntimeConfig {
  return current;
}

const isPosNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * 应用一层行为参数覆盖，返回**还原函数**(恢复为本调用前的配置)。
 *
 * - 非法值(非有限数 / ≤0 / 越界)逐键忽略，不阻断其余键(JSON 反序列化/宿主传值多脏)；
 * - 多次调用按栈还原：Provider/独立调用方各自持有还原函数，卸载即回退；
 * - `dockSnap` 会去重升序拷贝，避免调用方数组被后续原地修改影响。
 *
 * @param patch 部分覆盖；缺省键保持当前值
 * @returns 还原函数(可安全重复调用)
 * @category 渲染与主题
 */
export function configureRuntime(patch?: Partial<RuntimeConfig>): () => void {
  const prev = current;
  const next: RuntimeConfig = { ...prev, dockSnap: prev.dockSnap };
  if (patch) {
    if (isPosNum(patch.dockCenter) && patch.dockCenter < 0.5) next.dockCenter = patch.dockCenter;
    if (Array.isArray(patch.dockSnap)) {
      const snap = [...new Set(patch.dockSnap)].filter((n) => isPosNum(n) && n < 1);
      if (snap.length > 0) next.dockSnap = snap.sort((a, b) => a - b);
    }
    if (isPosNum(patch.minAreaW) && patch.minAreaW < 0.5) next.minAreaW = patch.minAreaW;
    if (isPosNum(patch.minAreaH) && patch.minAreaH < 0.5) next.minAreaH = patch.minAreaH;
    if (isPosNum(patch.cornerArm)) next.cornerArm = patch.cornerArm;
    if (isPosNum(patch.hitTolerance)) next.hitTolerance = patch.hitTolerance;
  }
  current = next;
  return () => {
    current = prev;
  };
}
