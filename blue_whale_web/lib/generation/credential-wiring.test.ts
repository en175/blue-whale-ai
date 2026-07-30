import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const WORKER_ENTRYPOINTS = [
  "blue_whale_web/workers/generation-worker.ts",
  "apps/generation-worker/src/index.ts",
];

describe("generation credential worker wiring", () => {
  it.each(WORKER_ENTRYPOINTS)(
    "%s uses only the shared dedicated secret loader",
    (relativePath) => {
      const source = readFileSync(path.join(repoRoot, relativePath), "utf8");

      expect(source).toContain("loadGenerationCredentialSecret");
      expect(source).not.toContain("JWT_SECRET");
      expect(source).not.toContain("blue-whale-dev-secret");
    },
  );
});
