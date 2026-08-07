import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

// IK747Z-1：后端/共享包 lint 制度（2026-08-07）
// 覆盖 apps/* 与 packages/*（blue_whale_web 使用其自己的 eslint.config.mjs，next 规则）。
// 规则与 web 对齐：max-lines 800 硬线 error，函数级规则渐进 warning。
// 历史巨型文件豁免挂账，待 IK747Z-4 拆分后逐个移除。

// 已知巨型文件清单（行数实测 2026-08-07，拆分后必须从豁免清单移除）
const LEGACY_LARGE_FILES = [
  "packages/persistence/src/agent-run-repo.ts",
  "packages/core/src/new-api-client.ts",
  "packages/persistence/src/generation-worker-repo.ts",
  "packages/persistence/src/plan-application-repo.ts",
  "packages/persistence/src/agent-run-repo.test.ts",
  "packages/persistence/src/skill-repo.test.ts",
  "packages/persistence/src/conversation-repo.test.ts",
  "packages/core/src/new-api-client.test.ts",
  "packages/persistence/src/plan-application-repo.test.ts",
  "apps/agent-worker/src/worker-loop.test.ts",
  "apps/agent-worker/src/worker-loop.ts",
  "packages/persistence/src/skill-repo.ts",
];

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
  // 历史巨型文件豁免（IK747Z-4 拆分完成后逐个删除本清单条目）
  {
    files: LEGACY_LARGE_FILES,
    rules: {
      "max-lines": "off",
    },
  },
  globalIgnores(["**/node_modules/**", "**/dist/**", "**/.next/**"]),
]);
