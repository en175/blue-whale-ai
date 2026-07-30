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
});
