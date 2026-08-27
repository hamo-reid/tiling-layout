import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { configToCssVars } from "./theme";
import type { LayoutConfig } from "./theme";

/**
 * LayoutProvider — 全局施加视觉/间距配置。
 * 把 config 展平为 --tl-* CSS 变量，作用于其容器内的所有布局实例；
 * 也可设置明/暗主题(documentElement[data-theme])。
 * @param props `config` 视觉/间距配置；`children` 被施加配置的子树
 * @category 渲染与主题
 */
export function LayoutProvider({
  config,
  children,
}: {
  config?: LayoutConfig;
  children: ReactNode;
}) {
  const varStyle = useMemo(() => configToCssVars(config), [config]);
  useEffect(() => {
    if (config?.colorMode) {
      document.documentElement.dataset.theme = config.colorMode === "system" ? "" : config.colorMode;
    }
  }, [config?.colorMode]);
  return (
    <div style={varStyle}>
      {children}
    </div>
  );
}