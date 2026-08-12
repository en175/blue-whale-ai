import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// IK747Z-1：规模与复杂度规则（2026-08-07）
// 硬线：文件 ≤800 行（error，CI 拦截）；渐进线：函数 ≤80 行、圈复杂度 ≤15、
// 参数 ≤5、嵌套 ≤4（warning，存量 238 处函数级超标随 IK747Z-3/-4 拆分消化后升 error）。
// 历史存量（巨型文件）通过下方 files 豁免挂账，待 IK747Z-3/-4 拆分后逐个移除豁免。

// 已知巨型文件清单（行数实测 2026-08-07，拆分后必须从豁免清单移除）
const LEGACY_LARGE_FILES = [
  // IK74V6 已拆达标：admin/users/page.tsx、lib/project-recovery.ts、
  // dock/ImageDockContent.tsx、components/AgentComposer.tsx 豁免已移除
  // 测试文件（随实现拆分同步治理）
  "lib/project-recovery.test.ts",
  "app/canvas/_canvas/hooks/useCanvasGeneration.test.ts",
  // IK77MH：812 行历史存量测试文件，与同目录 useCanvasGeneration/model.test 同类挂账，拆分后移除
  "app/canvas/_canvas/conversationRecovery.test.ts",
  // IK7GRP：lint-staged 从仓库根传入带 blue_whale_web/ 前缀的路径，
  // 纯相对路径 glob 在该场景不匹配导致豁免失效；加 **/ 前缀兼容两种调用 cwd。
  "**/lib/generation/worker/generation-worker.test.ts",
  // 后端/共享包（IK747Z-4 拆分）
  "../packages/persistence/src/agent-run-repo.ts",
  "../packages/core/src/new-api-client.ts",
  "../packages/persistence/src/generation-worker-repo.ts",
  "../packages/persistence/src/plan-application-repo.ts",
  "../packages/persistence/src/agent-run-repo.test.ts",
  "../packages/persistence/src/skill-repo.test.ts",
  "../packages/persistence/src/conversation-repo.test.ts",
  "../packages/core/src/new-api-client.test.ts",
  "../packages/persistence/src/plan-application-repo.test.ts",
  "../apps/agent-worker/src/worker-loop.test.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 规模/复杂度规则（max-lines 为硬线 error；函数级规则渐进 warning）
  {
    rules: {
      "max-lines": ["error", 800],
      "max-lines-per-function": ["warn", 80],
      complexity: ["warn", 15],
      "max-params": ["warn", 5],
      "max-depth": ["warn", 4],
    },
  },
  // 历史巨型文件豁免（IK747Z-3/-4 拆分完成后逐个删除本清单条目）
  {
    files: LEGACY_LARGE_FILES,
    rules: {
      "max-lines": "off",
    },
  },
  // 基线存量误报豁免（eslint-config-next 新规则误报，业务代码合法；
  // react-hooks 规则版本回落或官方修复后移除）
  {
    files: ["components/recharge/usePolling.ts"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "components/Toast/ToastProvider.tsx",
      "components/auth/ProfileModal.tsx",
      "components/recharge/useResponsive.ts",
      // Project 身份切换必须同步取消旧流并重置其仅内存态的对话投影；
      // 这不是派生状态，无法延后到异步订阅回调。
      "app/canvas/_canvas/hooks/useAgentMvpConversation.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["app/canvas/_canvas/utils.test.ts"],
    rules: {
      "@next/next/no-assign-module-variable": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // worker 构建产物（IK74V7：build:worker 产物会被 lint 扫到）
    ".worker-dist/**",
  ]),
]);

export default eslintConfig;
