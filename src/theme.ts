/**
 * theme.ts — 视觉/间距配置(设计令牌的唯一事实源)。
 *
 * 消费方提供一个部分覆盖的 LayoutConfig，运行时合并为 --tl-* CSS 变量(命名空间
 * 前缀，不与宿主冲突)，施加到 Provider(全局) 或 LayoutView*(实例)。CSS 里用
 * `var(--tl-x, 默认)` 兜底，因此不配任何东西时外观与默认完全一致(零回归)。
 */
import type { CSSProperties } from "react";

/** 间距类配置项
 * @category 渲染与主题
 */
export interface LayoutConfig {
  /** 明/暗/系统(写 documentElement[data-theme]) */
  colorMode?: "dark" | "light" | "system";
  /** 间距：区域间隔(描边宽) / 内容内边距 */
  spacing?: { regionGap?: number; padRegion?: number };
  /** 尺寸：区域头部高 / 角标尺寸 / 圆角 */
  sizing?: { headerH?: number; corner?: number; radius?: number };
}

/** 间距默认值：regionGap 区域间隔(描边宽)，padRegion 内容内边距
 * @category 渲染与主题
 */
export const SPACING_DEFAULTS = { regionGap: 2, padRegion: 8 };
/** 尺寸默认值：headerH 区域头部高，corner 角标尺寸，radius 圆角
 * @category 渲染与主题
 */
export const SIZING_DEFAULTS = { headerH: 26, corner: 14, radius: 6 };

/**
 * 合并默认值并把配置展平为 CSS 变量对象(可直接放进 React style，
 * 亦可用作 LayoutProvider 的注入源)。
 * CSS 自定义属性不在 CSSProperties 已知键集合内，此处做唯一一次断言，
 * 消费方无需再各自 as。
 * @param c 部分覆盖的配置；缺省项回退默认值
 * @returns `--tl-*` CSS 变量样式的 React style 对象
 * @category 渲染与主题
 */
export function configToCssVars(c?: LayoutConfig): CSSProperties {
  const s = { ...SPACING_DEFAULTS, ...c?.spacing };
  const z = { ...SIZING_DEFAULTS, ...c?.sizing };
  return {
    "--tl-region-gap": `${s.regionGap}px`,   // .tl-area-box 描边(区域间分隔)
    "--tl-pad-region": `${s.padRegion}px`,   // 内容内边距/头部横向内边距
    "--tl-header-h": `${z.headerH}px`,       // 区域头部高度
    "--tl-corner": `${z.corner}px`,          // 角标尺寸
    "--tl-radius": `${z.radius}px`,          // 区域圆角
  } as CSSProperties;
}