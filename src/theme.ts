/**
 * theme.ts — 视觉/间距配置(设计令牌的唯一事实源)。
 *
 * 消费方提供一个部分覆盖的 LayoutConfig，运行时合并为 --tl-* CSS 变量(命名空间
 * 前缀，不与宿主冲突)，施加到 Provider(全局) 或 LayoutView*(实例)。CSS 里用
 * `var(--tl-x, 默认)` 兜底，因此不配任何东西时外观与默认完全一致(零回归)。
 */
import type { CSSProperties } from "react";
import type { RuntimeConfig } from "./runtimeConfig";

/** 间距类配置项
 * @category 渲染与主题
 */
export interface LayoutConfig {
  /** 明/暗/系统(写 documentElement[data-theme]) */
  colorMode?: "dark" | "light" | "system";
  /** 间距：区域间隔(描边宽) / 内容内边距 / 舞台四周留白 */
  spacing?: { regionGap?: number; padRegion?: number; outerGap?: number };
  /** 尺寸：区域头部高 / 角标尺寸 / 圆角 / 分界线命中带宽 / 分界线线宽 */
  sizing?: { headerH?: number; corner?: number; radius?: number; splitter?: number; splitterLine?: number };
  /** 行为参数(停靠热区/吸附网格/最小区域/角点阈值/命中容差)。
   *  ⚠ 只能作用到全局单例(几何层/状态机无 React 上下文)：经 LayoutProvider 或
   *  configureRuntime 生效；写在 LayoutViewDom 的 theme 上会被忽略。 */
  interaction?: Partial<RuntimeConfig>;
}

/** 间距默认值：regionGap 区域间隔(描边宽)，padRegion 内容内边距，outerGap 舞台四周留白
 * @category 渲染与主题
 */
export const SPACING_DEFAULTS = { regionGap: 2, padRegion: 8, outerGap: 0 };
/** 尺寸默认值：headerH 区域头部高，corner 角标尺寸，radius 圆角，splitter 分界线命中带宽，splitterLine 分界线线宽
 * @category 渲染与主题
 */
export const SIZING_DEFAULTS = { headerH: 26, corner: 14, radius: 6, splitter: 6, splitterLine: 2 };

/**
 * 合并默认值并把配置展平为 CSS 变量对象(可直接放进 React style，
 * 亦可用作 LayoutProvider 的注入源)。
 * CSS 自定义属性不在 CSSProperties 已知键集合内，此处做唯一一次断言，
 * 消费方无需再各自 as。
 * @param c 部分覆盖的配置；缺省项回退默认值
 * @param opts.partial 只输出显式配置的键(不补默认)。LayoutViewDom 实例级用它，
 *        让 LayoutProvider 的全局变量穿透实例内联样式；非 partial 保持原语义(零回归)
 * @returns `--tl-*` CSS 变量样式的 React style 对象
 * @category 渲染与主题
 */
export function configToCssVars(c?: LayoutConfig, opts?: { partial?: boolean }): CSSProperties {
  const s = { ...SPACING_DEFAULTS, ...c?.spacing };
  const z = { ...SIZING_DEFAULTS, ...c?.sizing };
  const out: Record<string, string> = {};
  // partial:只输出显式配置的键(实例级用),让 LayoutProvider 施加在包裹 div 上的
  // 全局变量穿透实例内联样式;非 partial:输出全部键(含默认),保持原语义。
  // 判定用 typeof === "number" 而非 !== undefined:运行时可能混入 null/NaN(JSON 反序列化等),
  // 前者会让分支输出 `${null}px` 的非法 CSS,后者统一视为未配置。
  if (!opts?.partial || typeof c?.spacing?.regionGap === "number") out["--tl-region-gap"] = `${s.regionGap}px`;
  if (!opts?.partial || typeof c?.spacing?.padRegion === "number") out["--tl-pad-region"] = `${s.padRegion}px`;
  if (!opts?.partial || typeof c?.spacing?.outerGap === "number") out["--tl-outer-gap"] = `${s.outerGap}px`;
  if (!opts?.partial || typeof c?.sizing?.headerH === "number") out["--tl-header-h"] = `${z.headerH}px`;
  if (!opts?.partial || typeof c?.sizing?.corner === "number") out["--tl-corner"] = `${z.corner}px`;
  if (!opts?.partial || typeof c?.sizing?.radius === "number") out["--tl-radius"] = `${z.radius}px`;
  if (!opts?.partial || typeof c?.sizing?.splitter === "number") out["--tl-splitter"] = `${z.splitter}px`;
  if (!opts?.partial || typeof c?.sizing?.splitterLine === "number") out["--tl-splitter-line"] = `${z.splitterLine}px`;
  return out as CSSProperties;
}