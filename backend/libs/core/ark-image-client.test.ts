import { describe, expect, it, vi } from "vitest";

import { generateImages } from "./ark-image-client.js";

describe("generateImages", () => {
  it("sends sequential image generation options", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "https://cdn.test/sequence.png" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await generateImages(
      { baseUrl: "https://ark.test/api/v3", apiKey: "secret" },
      {
        model: "image-model",
        prompt: "four related scenes",
        n: 4,
        sequential: true,
      },
      fetchImpl,
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
    });
  });

  it("HTTP error + copyright restrictions → ArkImageError(content_rejected)（IKDAJN）", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        "The request failed because the output image may be related to copyright restrictions",
        { status: 500 },
      ),
    );

    await expect(
      generateImages(
        { baseUrl: "https://ark.test/api/v3", apiKey: "secret" },
        { model: "image-model", prompt: "x" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("HTTP error + 敏感内容 → ArkImageError(content_rejected)；HTTP 402 → quota_exhausted（IKDAJN）", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("信息可能包含敏感内容，请您更换内容后重试", { status: 403 }),
      )
      .mockResolvedValueOnce(
        new Response("预扣费额度失败, 用户剩余额度: ¥0.9", { status: 402 }),
      );

    await expect(
      generateImages(
        { baseUrl: "https://ark.test/api/v3", apiKey: "secret" },
        { model: "image-model", prompt: "x" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "content_rejected" });

    await expect(
      generateImages(
        { baseUrl: "https://ark.test/api/v3", apiKey: "secret" },
        { model: "image-model", prompt: "x" },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });
});
