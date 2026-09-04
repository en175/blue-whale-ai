import { describe, expect, it, vi } from "vitest";
import { NewApiError } from "@blue-whale/core";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("new-api video task provider", () => {
  it("submits once and observes one poll without holding a polling loop", async () => {
    const module = await import("./new-api-video-task-provider.js").catch(
      () => ({}),
    );
    const createProvider = (module as {
      createNewApiVideoTaskProvider?: (options: Record<string, unknown>) => {
        submit(input: Record<string, unknown>): Promise<unknown>;
        poll(taskId: string): Promise<unknown>;
      };
    }).createNewApiVideoTaskProvider;

    expect(createProvider).toBeTypeOf("function");
    if (!createProvider) return;

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ task_id: "task-1", status: "queued" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "success",
          data: {
            task_id: "task-1",
            status: "succeeded",
            result_url: "https://provider.test/video.mp4",
          },
        }),
      );
    const provider = createProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
    });

    await expect(
      provider.submit({
        model: "seedance-2",
        prompt: "鲸鱼游动",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).resolves.toEqual({ taskId: "task-1", status: "queued" });
    await expect(provider.poll("task-1")).resolves.toEqual({
      status: "succeeded",
      progress: 100,
      url: "https://provider.test/video.mp4",
      error: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps upstream content-policy FAILURE to content_rejected (IKDAJN)", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          code: "success",
          data: {
            task_id: "task-failure",
            status: "FAILURE",
            error: { code: "OutputAudioSensitiveContentDetected.PolicyViolation", message: "版权审核失败" },
          },
        }),
      ),
    });

    await expect(provider.poll("task-failure")).resolves.toEqual({
      status: "failed",
      progress: 100,
      url: null,
      error: { code: "content_rejected", message: "版权审核失败" },
    });
  });

  it("maps upstream quota/balance failure to quota_exhausted (IKBQEE/ADR-0078)", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          code: "success",
          data: {
            task_id: "task-quota",
            status: "FAILURE",
            error: {
              code: "account_balance_insufficient",
              message: "The request failed because your account has an overdue balance.",
            },
          },
        }),
      ),
    });

    await expect(provider.poll("task-quota")).resolves.toEqual({
      status: "failed",
      progress: 100,
      url: null,
      error: {
        code: "quota_exhausted",
        message: "The request failed because your account has an overdue balance.",
      },
    });
  });

  it("passes through non-quota upstream failure code (IKBQEE)", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockResolvedValue(
        jsonResponse({
          code: "success",
          data: {
            task_id: "task-nonquota",
            status: "FAILURE",
            error: { code: "some_upstream_code", message: "upstream broke" },
          },
        }),
      ),
    });

    await expect(provider.poll("task-nonquota")).resolves.toEqual({
      status: "failed",
      progress: 100,
      url: null,
      error: { code: "some_upstream_code", message: "upstream broke" },
    });
  });

  it("maps submit NewApiError quota signal to quota_exhausted (job 1612 预扣费)", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockRejectedValue(
        new NewApiError(
          "预扣费额度失败, 用户剩余额度: ¥2.123294, 需要预扣费额度: ¥7.000000",
          200,
        ),
      ),
    });

    await expect(
      provider.submit({
        model: "seedance-2",
        prompt: "小猫",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("maps submit NewApiError content-policy signal to content_rejected (IKDAJN 敏感信息)", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockRejectedValue(
        new NewApiError("生成内容可能包含敏感信息", 200, "sensitive_content"),
      ),
    });

    await expect(
      provider.submit({
        model: "seedance-2",
        prompt: "测试",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("submit non-quota NewApiError falls back to provider_failed", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockRejectedValue(new NewApiError("gateway down", 503)),
    });

    await expect(
      provider.submit({
        model: "seedance-2",
        prompt: "测试",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).rejects.toMatchObject({ code: "provider_failed" });
  });

  it("submit HTTP 402 NewApiError maps to quota_exhausted even without keyword", async () => {
    const module = await import("./new-api-video-task-provider.js");
    const provider = module.createNewApiVideoTaskProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl: vi.fn().mockRejectedValue(new NewApiError("request failed", 402)),
    });

    await expect(
      provider.submit({
        model: "seedance-2",
        prompt: "测试",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("submit 走 30s 硬超时而非默认 10s（火山高峰慢提交不误报失败）", async () => {
    vi.useFakeTimers();
    try {
      const module = await import("./new-api-video-task-provider.js");
      const fetchImpl = vi.fn(
        (_url: string, init: RequestInit | undefined) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              reject(new Error("missing signal"));
              return;
            }
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      );
      const provider = module.createNewApiVideoTaskProvider({
        baseUrl: "http://new-api.test",
        token: "sk-user",
        fetchImpl,
      });

      const submitPromise = provider.submit({
        model: "seedance-2",
        prompt: "慢提交",
        duration: 5,
        width: 1280,
        height: 720,
      });
      // 先挂 no-op catch 避免 timer 推进触发 abort 时出现未处理拒绝
      submitPromise.catch(() => {});

      // 默认 10s 时点，submit 的 30s 超时不应触发
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false);

      // 累计 30s 触发 abort → provider_failed
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(submitPromise).rejects.toMatchObject({
        code: "provider_failed",
      });
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
