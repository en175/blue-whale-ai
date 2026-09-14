import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// backend/libs vitest 设施：`@lib/*` 别名对齐 backend/tsconfig.json paths。
// packages/ 层已并入 backend/libs（ADR-0077 落地），不再有独立包引用。
export default defineConfig({
  resolve: {
    alias: {
      "@lib": fileURLToPath(new URL("./backend/libs", import.meta.url)),
    },
  },
  test: {
    // tests/*.test.mjs 是 node:test 套件（由 node --test 单独跑），不是 vitest 用例。
    include: ["backend/**/*.test.ts"],
  },
});
