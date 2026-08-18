import { describe, expect, it, vi } from "vitest";

function audioResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", ...headers },
  });
}

describe("new-api audio provider", () => {
  it("POST /v1/audio/speech → 返回原始字节 + mime + requestId", async () => {
    const module = await import("./new-api-audio-provider.js");
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]); // ID3 header
    const fetchImpl = vi.fn().mockResolvedValue(
      audioResponse(bytes, { "X-Oneapi-Request-Id": "req-audio-1" }),
    );
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
    });
    const result = await provider.generate({
      model: "seed-audio-1.0",
      prompt: "海浪声 30 秒",
    });
    expect(result.data).toEqual(bytes);
    expect(result.mime).toBe("audio/mpeg");
    expect(result.requestId).toBe("req-audio-1");
    // 请求体映射:prompt → input,response_format 固定 mp3
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://new-api.test/v1/audio/speech");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "seed-audio-1.0",
      input: "海浪声 30 秒",
      response_format: "mp3",
    });
  });

  it("非 2xx → AudioProviderError(provider_failed)", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "provider_failed" });
  });

  it("空响应体 → AudioProviderError(no_result)", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response(new Uint8Array(0), { status: 200 })),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "no_result" });
  });
});
