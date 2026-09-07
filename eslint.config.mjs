import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// IK747Z-1：后端/共享包 lint 制度（2026-08-07）
// 覆盖 packages/*（blue_whale_web 已删除）。
// max-lines 800 硬线 error，函数级规则渐进 warning。
//
// IK747Z-4（IK74V8，2026-08-08）：12 个历史巨型文件全部拆分完成，豁免清单已清空。
// 后端/共享包与前端一样，800 行是无豁免硬线——新文件超限直接 lint fail，不再挂账。

export default defineConfig([
  ...tseslint.configs.recommended,
  // 规模/复杂度规则（max-lines 为硬线 error；函数级规则渐进 warning）
  {
    rules: {
      "max-lines": ["error", 800],
      "max-lines-per-function": ["warn", 80],
      complexity: ["warn", 15],
      "max-params": ["warn", 5],
      "max-depth": ["warn", 4],
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
