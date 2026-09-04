import { describe, expect, it } from "vitest";

import { createFakeGenerationAdapter } from "./fake-generation-adapter.js";

describe("Fake Generation Adapter", () => {
  it("同一规范化请求产生稳定的产品中立结果", async () => {
    const adapter = createFakeGenerationAdapter();

    await expect(
      adapter.generate({ prompt: "a blue whale", outputIndex: 0 }),
    ).resolves.toEqual({
      provider: "fake",
      mediaType: "image/png",
      contentId:
        "fa559137075ec3a9673026c9fa5422c557a23d87a4ecec02d93c9888b1dafbb1",
      uri:
        "fake://assets/fa559137075ec3a9673026c9fa5422c557a23d87a4ecec02d93c9888b1dafbb1.png",
    });
  });
});
