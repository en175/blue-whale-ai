import { metricEventsFrom } from "@blue-whale/core/logging";
import { describe, expect, it, vi } from "vitest";

function metricsClaim(overrides: Record<string, unknown> = {}) {
  return {
    id: "777",
    projectId: "55",
    userId: "9",
    input: {
      prompt: "指标测试",
      model_id: "seedance-2",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 5,
      provider_credential: "sealed-token",
    },
    providerTaskId: "up-1",
    cancelRequested: false,
    workerId: "worker-metrics",
    fencingToken: 1,
    ...overrides,
  };
}

function metricsRepo(overrides: Record<string, unknown> = {}) {
  return {
    claimVideoJobById: vi.fn().mockResolvedValue(metricsClaim()),
    claimNextVideoJob: vi.fn(),
    resolveInputAssets: vi.fn().mockResolvedValue([]),
    markVideoSubmitted: vi.fn().mockResolvedValue(true),
    rescheduleVideoPoll: vi.fn(),
    publishVideoResult: vi.fn().mockResolvedValue(true),
    failVideoJob: vi.fn().mockResolvedValue(true),
    cancelVideoBeforeDispatch: vi.fn(),
    ...overrides,
  };
}

describe("video job metrics（IK7G9Y）", () => {
  it("成功路径打 provider_call(poll) 计时与 task_finished ok", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const poll = vi.fn().mockResolvedValue({
      status: "succeeded",
      progress: 100,
      url: "https://v.test/out.mp4",
      error: null,
    });
    const repo = metricsRepo();

    await runVideoJobStep({
      repo,
      workerId: "worker-metrics",
      jobId: "777",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: () => "sk-user" },
      mediaRelay: {
        persist: vi.fn().mockResolvedValue({
          url: "tos://stored",
          storageKey: null,
          mime: null,
          size: null,
        }),
      },
    });

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "provider_call",
        result: "ok",
        provider: "new_api_video",
        operation: "poll",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "task_finished",
        result: "ok",
        job_type: "video_generation",
      }),
    );
    const callEvent = events.find((e) => e.event === "provider_call")!;
    expect(typeof callEvent.duration_ms).toBe("number");
    logSpy.mockRestore();
  });

  it("provider 观察 failed：provider_call(poll) ok + task_finished fail 带 failure_code", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      progress: 40,
      url: null,
      error: { code: "provider_timeout", message: "upstream timeout" },
    });
    const repo = metricsRepo();

    await runVideoJobStep({
      repo,
      workerId: "worker-metrics",
      jobId: "777",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: () => "sk-user" },
      mediaRelay: { persist: vi.fn() },
    });

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "provider_call", result: "ok", operation: "poll" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: "task_finished",
        result: "fail",
        job_type: "video_generation",
        failure_code: "provider_timeout",
      }),
    );
    expect(repo.failVideoJob).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("submit 抛错：provider_call(submit) fail + task_finished fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockRejectedValue(new Error("gateway down"));
    const repo = metricsRepo({
      claimVideoJobById: vi.fn().mockResolvedValue(metricsClaim({ providerTaskId: null })),
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-metrics",
      jobId: "777",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: () => "sk-user" },
      mediaRelay: { persist: vi.fn() },
    });

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(events).toContainEqual(
      expect.objectContaining({ event: "provider_call", result: "fail", operation: "submit" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ event: "task_finished", result: "fail" }),
    );
    logSpy.mockRestore();
  });

  it("failVideoJob 返回 false（fencing 竞态失败）时不打 task_finished，避免双计", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      progress: 40,
      url: null,
      error: { code: "provider_timeout", message: "upstream timeout" },
    });
    const repo = metricsRepo({
      failVideoJob: vi.fn().mockResolvedValue(false),
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-metrics",
      jobId: "777",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: () => "sk-user" },
      mediaRelay: { persist: vi.fn() },
    });

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(repo.failVideoJob).toHaveBeenCalled();
    expect(events.filter((e) => e.event === "task_finished")).toEqual([]);
    logSpy.mockRestore();
  });

  it("publishVideoResult 返回 false（fencing 竞态失败）时不打 task_finished，避免双计", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const poll = vi.fn().mockResolvedValue({
      status: "succeeded",
      progress: 100,
      url: "https://v.test/out.mp4",
      error: null,
    });
    const repo = metricsRepo({
      publishVideoResult: vi.fn().mockResolvedValue(false),
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-metrics",
      jobId: "777",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: () => "sk-user" },
      mediaRelay: {
        persist: vi.fn().mockResolvedValue({
          url: "tos://stored",
          storageKey: null,
          mime: null,
          size: null,
        }),
      },
    });

    const events = metricEventsFrom(logSpy.mock.calls);
    expect(repo.publishVideoResult).toHaveBeenCalled();
    expect(events.filter((e) => e.event === "task_finished")).toEqual([]);
    logSpy.mockRestore();
  });
});
