import { describe, expect, it, vi } from "vitest";

import { createGenerationImageProvider } from "./ark-image-provider";

const input = {
  model: "image-model",
  prompt: "a whale",
  n: 1,
  width: 1024,
  height: 1024,
};

describe("generation image provider routing", () => {
  it("defaults to new-api relay and forwards the user's sk token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.test/new-api.png" }] }),
          { status: 200 },
        ),
      );
    const provider = createGenerationImageProvider({
      env: { NEW_API_BASE_URL: "http://new-api.test" },
      token: "sk-user",
      fetchImpl,
    });

    await expect(provider.generate(input)).resolves.toEqual([
      { url: "https://cdn.test/new-api.png", width: 1024, height: 1024 },
    ]);
    const newApiRequest = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://new-api.test/v1/images/generations",
    );
    expect(new Headers(newApiRequest.headers).get("Authorization")).toBe(
      "Bearer sk-user",
    );
  });

  it("uses new-api multipart edits when the worker supplies a source image", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.test/edited.png" }] }),
          { status: 200 },
        ),
      );
    const provider = createGenerationImageProvider({
      env: { NEW_API_BASE_URL: "http://new-api.test" },
      token: "sk-user",
      fetchImpl,
    });

    await expect(
      provider.generate({
        ...input,
        sourceImage: {
          blob: new Blob(["image-bytes"], { type: "image/png" }),
          fileName: "source.png",
        },
      }),
    ).resolves.toEqual([
      { url: "https://cdn.test/edited.png", width: 1024, height: 1024 },
    ]);

    const request = fetchImpl.mock.calls[0];
    expect(request?.[0]).toBe("http://new-api.test/v1/images/edits");
    expect(request?.[1]?.body).toBeInstanceOf(FormData);
  });

  it("uses direct Ark only when GENERATION_PROVIDER=ark is explicit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ url: "https://cdn.test/ark.png" }] }),
          { status: 200 },
        ),
      );
    const provider = createGenerationImageProvider({
      env: {
        GENERATION_PROVIDER: "ark",
        VOLC_ARK_BASE_URL: "http://ark.test/api/v3",
        VOLC_ARK_API_KEY: "ark-key",
      },
      token: "sk-user",
      fetchImpl,
    });

    await expect(provider.generate(input)).resolves.toEqual([
      { url: "https://cdn.test/ark.png", width: 1024, height: 1024 },
    ]);
    const arkRequest = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "http://ark.test/api/v3/images/generations",
    );
    expect(new Headers(arkRequest.headers).get("Authorization")).toBe(
      "Bearer ark-key",
    );
  });
});
