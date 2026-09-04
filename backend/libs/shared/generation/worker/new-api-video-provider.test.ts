import { describe, expect, it, vi } from "vitest";

const { createNewApiClient } = vi.hoisted(() => ({
  createNewApiClient: vi.fn(),
}));

// 旧同步 video provider（backend）：submit/poll 失败分类测试。
// FAILED 分支直接经 generate() 轮询观察（getVideoTask 返回 FAILURE 观察对象）驱动；
// providerError 路径经 getVideoTask 抛 NewApiError 驱动。createNewApiClient 被 mock。
vi.mock("@blue-whale/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blue-whale/core")>();
  return { ...actual, createNewApiClient };
});

import { NewApiError } from "@blue-whale/core";
import { createNewApiVideoProvider } from "./new-api-video-provider.js";

function buildClientMock(options: {
  submitError?: NewApiError;
  getVideoTask?: () => Promise<unknown>;
  submitVideo?: () => Promise<unknown>;
}) {
  const submitVideo = options.submitVideo ?? (() => Promise.resolve({ taskId: "task-1" }));
  const getVideoTask = options.getVideoTask ?? (() => Promise.reject(new Error("no task")));
  createNewApiClient.mockReturnValue({ submitVideo, getVideoTask });
  return { submitVideo, getVideoTask };
}

function buildFailureTask(error: { code?: string; message?: string }) {
  return () =>
    Promise.resolve({
      status: "FAILURE",
      task_id: "task-1",
      error,
    });
}

function generateInput() {
  return {
    model: "seedance-2",
    prompt: "x",
    duration: 5,
    width: 1280,
    height: 720,
    resolution: "1080p",
    ratio: "16:9",
  };
}

describe("new-api video provider 错误分类（IKDAJN）", () => {
  it("poll FAILED + copyright restrictions → content_rejected（FAILED 分支）", async () => {
    buildClientMock({
      getVideoTask: buildFailureTask({
        code: "OutputSensitiveContentDetected",
        message:
          "The request failed because the output video may be related to copyright restrictions",
      }),
    });
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      maxPollAttempts: 1,
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("poll FAILED + 敏感信息 → content_rejected（FAILED 分支）", async () => {
    buildClientMock({
      getVideoTask: buildFailureTask({
        code: "OutputSensitiveContentDetected",
        message: "生成内容可能包含敏感信息，请您更换内容后重试",
      }),
    });
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      maxPollAttempts: 1,
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("poll FAILED + 欠费 → quota_exhausted（FAILED 分支，不被 content 正则抢语义）", async () => {
    buildClientMock({
      getVideoTask: buildFailureTask({
        code: "account_balance_insufficient",
        message: "预扣费额度失败, 用户剩余额度: ¥0.9",
      }),
    });
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      maxPollAttempts: 1,
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });

  it("providerError 路径：getVideoTask 抛 copyright NewApiError → content_rejected", async () => {
    buildClientMock({
      getVideoTask: () =>
        Promise.reject(
          new NewApiError(
            "The request failed because the output video may be related to copyright restrictions",
            500,
          ),
        ),
    });
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      maxPollAttempts: 1,
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "content_rejected" });
  });

  it("providerError 路径：getVideoTask 抛欠费 NewApiError → quota_exhausted", async () => {
    buildClientMock({
      getVideoTask: () =>
        Promise.reject(
          new NewApiError("预扣费额度失败, 用户剩余额度: ¥0.9", 200),
        ),
    });
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      maxPollAttempts: 1,
    });
    await expect(
      provider.generate(generateInput()),
    ).rejects.toMatchObject({ code: "quota_exhausted" });
  });
});
