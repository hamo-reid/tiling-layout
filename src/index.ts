/**
 * tiling-layout — 库公共入口。
 * 以 public-api.ts(公开面白名单)为唯一对外出口；TypeDoc 据此生成 API 参考。
 * 消费者：import { useLayoutData, LayoutViewDom, migrateSnapshot } from "tiling-layout";
 */
import "./styles/index.css"; // 主题 tokens + 组件样式(→ dist/tiling-layout.css)

export * from "./public-api";