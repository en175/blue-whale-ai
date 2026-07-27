import { describe, expect, it, vi } from "vitest";

import {
  createNewApiVideoProvider,
  VideoProviderError,
} from "./new-api-video-provider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("new-api video provider", () => {
  it("submits and polls until the task returns a video URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: "task-1", status: "queued" }))
      .mockResolvedValueOnce(
        jsonResponse({
          code: "success",
          data: { task_id: "task-1", status: "processing" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "success",
          data: {
            task_id: "task-1",
            status: "succeeded",
            url: "https://cdn.test/video.mp4",
          },
        }),
      );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
      sleep,
      pollIntervalMs: 1,
      maxPollAttempts: 3,
    });

    await expect(
      provider.generate({
        model: "video-model",
        prompt: "a whale swims",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).resolves.toEqual({
      url: "https://cdn.test/video.mp4",
      width: 1280,
      height: 720,
    });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.map((call) => call[0])).toEqual([
      "http://new-api.test/v1/video/generations",
      "http://new-api.test/v1/video/generations/task-1",
      "http://new-api.test/v1/video/generations/task-1",
    ]);
  });

  it("fails with provider_timeout after the bounded polling attempts", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: "task-1", status: "queued" }))
      .mockImplementation(async () =>
        jsonResponse({
          code: "success",
          data: { task_id: "task-1", status: "processing" },
        }),
      );
    const provider = createNewApiVideoProvider({
      baseUrl: "http://new-api.test",
      token: "sk-user",
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      maxPollAttempts: 2,
      pollIntervalMs: 1,
    });

    await expect(
      provider.generate({
        model: "video-model",
        prompt: "a whale swims",
        duration: 5,
        width: 1280,
        height: 720,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<VideoProviderError>>({
        code: "provider_timeout",
      }),
    );
  });
});
