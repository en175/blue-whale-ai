import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lib": fileURLToPath(new URL("./backend/libs", import.meta.url)),
    },
  },
  test: {
    include: ["backend/**/*.test.ts"],
    setupFiles: ["tests/vitest.setup.ts"],
  },
});
