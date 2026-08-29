import { describe, expect, it, vi } from "vitest";

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

  it("maps NewAPI FAILURE status to a terminal failed observation", async () => {
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
      error: { code: "OutputAudioSensitiveContentDetected.PolicyViolation", message: "版权审核失败" },
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
});
