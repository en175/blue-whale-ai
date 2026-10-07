import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    rules: {
      "max-lines": ["warn", 800],
      "max-lines-per-function": ["warn", 80],
      complexity: ["warn", 15],
      "max-params": ["warn", 5],
      "max-depth": ["warn", 4],
      "@typescript-eslint/no-explicit-any": "warn",
      // `_` 前缀 = 故意不用（参数/变量/捕获异常）；ignoreRestSiblings = 解构剔除字段（{ a, ...rest }）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // 前端（web/src）react-hooks 规则：只启用两条经典规则。
  // 插件 v7 recommended 含大量激进新规则（static-components/use-memo 等），会照亮存量代码，不引入。
  {
    files: ["web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/.next/**"]),
]);
