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
          JSON.stringify({ error: { message: "预扣费额度失败, 用户剩余额度: ¥0.9" } }),
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

  it("非 2xx + body 含 copyright restrictions → AudioProviderError(content_rejected)（IKDAJN）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          "The request failed because the output image may be related to copyright restrictions",
          { status: 500 },
        ),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("非 2xx + body 含 may contain sensitive information → AudioProviderError(content_rejected)（IKDAJN）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          "The request failed because the output image may contain sensitive information",
          { status: 500 },
        ),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("HTTP200+body 版权限制 → AudioProviderError(content_rejected)（IKDAJN 文案不泄漏原文）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "信息可能涉及版权限制，请您更换后重试" },
          }),
          { status: 200 },
        ),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({
      code: "content_rejected",
      message: "生成内容涉及版权或敏感信息",
    });
  });

  it("HTTP200+body 错误信封含版权文案 → content_rejected（IKDAJN 仅判 error.message）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: "账户余额不足，且信息可能包含敏感内容" },
          }),
          { status: 200 },
        ),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("HTTP200 + 合法音频 base64（人工含 quota/balance 子串）→ 不抛 quota_exhausted、正确返回音频（IKDQ5F 根因）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const base64 = "qUOtAbAlAnCeInSuFfIcIeNtPaYmEnTqUoTaSUQzBAAA";
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ audio: base64, duration: 3.2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
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
    expect(result.data).toEqual(new Uint8Array(Buffer.from(base64, "base64")));
    expect(result.duration).toBe(3.2);
  });

  it("HTTP 非 2xx 含欠费文案 → AudioProviderError(quota_exhausted)（IKDQ5F）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("预扣费额度失败, 用户剩余额度: ¥0.9", { status: 500 }),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("HTTP200+body 无用户语境的「余额不足」→ 不再误判欠费（IKDQ5F；纯文本走 no_result）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      // 1743 现场：网关超时/失败文案是纯文本（非信封 JSON），含「余额」但无用户/账户语境。
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("new-api 音频生成余额不足", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "no_result" });
  });

  it("fetch 超时（AbortController 主动中止）→ AudioProviderError(provider_timeout)（IKDQ5F）", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      timeoutMs: 50,
      // 模拟真实 fetch：遵守 signal，abort 时 reject AbortError（如 AbortSignal.timeout）。
      fetchImpl: (_input, init = {}) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init.signal ?? null) as AbortSignal | null;
          const abortHandler = () => reject(new DOMException("Aborted", "AbortError"));
          signal?.addEventListener("abort", abortHandler, { once: true });
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abortHandler);
            resolve(new Response("too late", { status: 200 }));
          }, 200);
          void timer;
        }),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "provider_timeout" });
  });

  it("fetch 网络异常（非超时）→ AudioProviderError(provider_failed)", async () => {
    const module = await import("./new-api-audio-provider.js");
    const provider = module.createNewApiAudioProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(
      provider.generate({ model: "seed-audio-1.0", prompt: "x" }),
    ).rejects.toMatchObject({ code: "provider_failed" });
  });
});
