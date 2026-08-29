import { describe, expect, it, vi } from "vitest";

function officialAudioJson(overrides: Record<string, unknown> = {}): Response {
  const body = {
    audio: "SUQzBAAA",
    duration: 20.38,
    original_duration: 20.38,
    url: "https://openspeech.example/audio/signed-xxx",
    ...overrides,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("new-api audio provider", () => {
  it("POST /v1/audio/speech → 解析官方 JSON:base64 audio→data、url、duration、官方请求体", async () => {
    const module = await import("./new-api-audio-provider.js");
    const base64 = "SUQzBAAA";
    const fetchImpl = vi.fn().mockResolvedValue(officialAudioJson({ audio: base64 }));
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
    });
    const result = await provider.generate({
      model: "seed-audio-1.0",
      prompt: "海浪声 30 秒",
    });
    // 官方 base64 → 解码字节(data 优先,不受 url 过期影响)
    expect(result.data).toEqual(new Uint8Array(Buffer.from(base64, "base64")));
    expect(result.url).toBe("https://openspeech.example/audio/signed-xxx");
    expect(result.duration).toBe(20.38);
    expect(result.mime).toBe("audio/mpeg");
    // 请求体为官方透传格式:text_prompt 而非 input,audio_config 固定 mp3/48000
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://new-api.test/v1/audio/speech");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: "seed-audio-1.0",
      text_prompt: "海浪声 30 秒",
      audio_config: {
        format: "mp3",
        sample_rate: 48000,
        pitch_rate: 0,
        speech_rate: 0,
        loudness_rate: 0,
      },
      watermark: {},
    });
    expect(body).not.toHaveProperty("input");
  });

  it("仅 url 无 audio 字段 → url 带回、data 为 undefined", async () => {
    const module = await import("./new-api-audio-provider.js");
    const fetchImpl = vi.fn().mockResolvedValue(
      officialAudioJson({
        audio: undefined,
        url: "https://openspeech.example/audio/only-url",
      }),
    );
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
    });
    const result = await provider.generate({
      model: "seed-audio-1.0",
      prompt: "x",
    });
    expect(result.url).toBe("https://openspeech.example/audio/only-url");
    expect(result.data).toBeUndefined();
    expect(result.duration).toBe(20.38);
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

  it("HTTP 402 → AudioProviderError(quota_exhausted)（IKBQEE 余额识别）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi
        .fn()
        .mockResolvedValue(new Response("余额不足", { status: 402 })),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("HTTP200+body 预扣费失败 → AudioProviderError(quota_exhausted)（IKBQEE）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: "预扣费额度失败, 用户剩余额度: ¥0.9" }),
          { status: 200 },
        ),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("空/非法响应 → AudioProviderError(no_result)", async () => {
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
