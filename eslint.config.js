import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * ESLint 扁平配置（库源码 / demo / 测试）。
 * 目标：类型安全的通用最佳实践 + React Hooks 规则；产物与文档站不参与。
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**", "dist-demo/**", "coverage/**", "docs/**", "node_modules/**",
      "tmp/**", "**/*.d.ts", "docs/docs/api/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 允许显式 any（少量 DOM/第三方边界）；下划线前缀视为有意忽略
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly" },
    },
  },
);
