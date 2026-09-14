import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * demo 独立构建配置(区别于 `vite.config.ts` 的库 lib 模式)。
 *
 * 入口 = 根 `index.html` → `/demo/main.tsx`;产物 `dist-demo/`。用途:CI 体检
 * (demo 过去只 typecheck、从不打包,打包期问题会漏)——产物不入库、不发布。
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
  },
});
