import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    react(),
    // 库模式：为 src(库)生成 .d.ts 声明
    dts({ include: ["src"], insertTypesEntry: true }),
  ],
  build: {
    // 生产：打包为库(ESM + CJS)，不把 React/zustand 打进产物
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      name: "TilingLayout",
      formats: ["es", "cjs"],
      fileName: (fmt) => (fmt === "es" ? "tiling-layout.mjs" : "tiling-layout.cjs"),
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "zustand"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/index.ts", "src/public-api.ts", "src/styles/**"],
      reporter: ["text", "html"],
    },
  },
});