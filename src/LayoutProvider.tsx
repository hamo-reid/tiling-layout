import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { configToCssVars } from "./theme";
import type { LayoutConfig } from "./theme";

/** LayoutProvider 的 props
 * @category 渲染与主题
 */
export interface LayoutProviderProps {
  /** 视觉/间距配置 */
  config?: LayoutConfig;
  /** 被施加配置的子树 */
  children: ReactNode;
}

/**
 * LayoutProvider — 全局施加视觉/间距配置。
 * 把 config 展平为 --tl-* CSS 变量，作用于其容器内的所有布局实例；
 * 也可设置明/暗主题(documentElement[data-theme])。
 *
 * colorMode 语义：dark/light 显式写 data-theme；"system" **移除**该属性——
 * tokens.css 以 `:root:not([data-theme]) + prefers-color-scheme` 跟随系统，
 * 写入空值属性会让系统跟随失效。组件卸载时还原进入前的属性值(副作用可逆)。
 */
export function LayoutProvider({ config, children }: LayoutProviderProps) {
  const varStyle = useMemo(() => configToCssVars(config), [config]);
  useEffect(() => {
    if (!config?.colorMode) return;
    const root = document.documentElement;
    const prev = root.getAttribute("data-theme");
    if (config.colorMode === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = config.colorMode;
    return () => {
      // 还原进入前的值，避免全局副作用泄漏到宿主页面的其余部分
      if (prev === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", prev);
    };
  }, [config?.colorMode]);
  return (
    <div style={varStyle}>
      {children}
    </div>
  );
}
