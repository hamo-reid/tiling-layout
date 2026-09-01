import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    react(),
    // 库模式：为 src(库)生成 .d.ts 声明，并合并为单一 index.d.ts
    dts({ include: ["src"], rollupTypes: true }),
  ],
  build: {
    // 生产：打包为库(ESM + CJS)，不把 React/zustand 打进产物
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "TilingLayout",
      formats: ["es", "cjs"],
      fileName: (fmt) => (fmt === "es" ? "tiling-layout.mjs" : "tiling-layout.cjs"),
      // 注：Vite 5 的 lib 选项没有 cssFileName(Vite 6 才加入)；CSS 产物命名
      // 由下方 assetFileNames 兜底为 tiling-layout.css
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "zustand"],
      // Vite 5 不支持 lib.cssFileName，用 assetFileNames 把 CSS 产物命名为 tiling-layout.css
      output: { assetFileNames: "tiling-layout[extname]" },
    },
    // 库产物不压缩(消费方打包器会再处理)，保留 sourcemap 便于消费方调试；
    // cssMinify 默认跟随 minify，需单独开启
    minify: false,
    cssMinify: "esbuild",
    sourcemap: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/index.ts", "src/public-api.ts", "src/styles/**"],
      reporter: ["text", "html"],
      // 覆盖率闸门：低于当前水位(93/87/90)即失败，防回归；刻意留余量容许
      // 个别防御分支的波动
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 85,
        lines: 90,
      },
    },
  },
});