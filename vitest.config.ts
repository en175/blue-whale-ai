import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// backend/libs vitest 设施（IK9ILQ 音频生成接入设计承诺：核心逻辑单测）。
// 根配置：不破坏既有 `pnpm test:unit` = `vitest run packages` 行为——
// include 同时保留 packages 与 backend；`@lib/*` 别名对齐 backend/tsconfig.json paths。
export default defineConfig({
  resolve: {
    alias: {
      "@lib": fileURLToPath(new URL("./backend/libs", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "backend/**/*.test.ts"],
  },
});
