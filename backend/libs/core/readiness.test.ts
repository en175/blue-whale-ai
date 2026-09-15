import { describe, expect, it } from "vitest";

import { checkReadiness } from "./readiness.js";

describe("checkReadiness", () => {
  it("任一公开依赖未就绪时返回 not_ready 并保留逐项结果", async () => {
    await expect(
      checkReadiness("generation-worker", [
        { name: "mysql", check: async () => true },
        { name: "fake-generation-runtime", check: async () => false },
      ]),
    ).resolves.toEqual({
      status: "not_ready",
      service: "generation-worker",
      dependencies: [
        { name: "mysql", status: "ready" },
        { name: "fake-generation-runtime", status: "not_ready" },
      ],
    });
  });
});
