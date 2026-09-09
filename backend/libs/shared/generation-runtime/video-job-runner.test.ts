import { describe, expect, it, vi } from "vitest";

import { MAX_VIDEO_POLLS, VIDEO_POLL_INTERVAL_MS } from "./video-job-runner.js";

type JobState = {
  status: "queued" | "processing" | "succeeded";
  providerTaskId: string | null;
  leaseOwner: string | null;
  fencingToken: number;
  outputUrl: string | null;
};

describe("video job runner recovery", () => {
  it("passes first and last frames to the provider without ordinary references", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-frames", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "301",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "从首帧过渡到尾帧",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "11",
          last_frame_asset_id: "12",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-frames",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/first.png" },
        { id: "12", type: "image", url: "https://tos.test/last.png" },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-frames",
      jobId: "301",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(repo.resolveInputAssets).toHaveBeenCalledWith(["11", "12"], "9", "55");
    expect(submit).toHaveBeenCalledWith({
      model: "seedance-2",
      prompt: "从首帧过渡到尾帧",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      firstFrameImage: "https://tos.test/first.png",
      lastFrameImage: "https://tos.test/last.png",
      references: [],
    });
  });

  it("preserves ordered image and video references from trusted Assets", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-references", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "302",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "修改视频风格",
          model_id: "doubao-seedance-2-0-260128",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 8,
          reference_asset_ids: ["11", "12", "13"],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-references",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/a.png", mime: "image/png" },
        { id: "12", type: "video", url: "https://tos.test/b.mp4", mime: "video/mp4", size: 100, duration: 7 },
        { id: "13", type: "image", url: "https://tos.test/c.png", mime: "image/png" },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-references",
      jobId: "302",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith({
      model: "doubao-seedance-2-0-260128",
      prompt: "修改视频风格",
      duration: 8,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      references: [
        { type: "image", url: "https://tos.test/a.png" },
        { type: "video", url: "https://tos.test/b.mp4" },
        { type: "image", url: "https://tos.test/c.png" },
      ],
    });
  });

  it("accepts the Seedance 2.0 boundary of nine images and three videos", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-boundary", status: "queued" });
    const assets = [
      ...Array.from({ length: 9 }, (_, index) => ({
        id: String(index + 1),
        type: "image",
        url: `https://tos.test/${index + 1}.png`,
        mime: "image/png",
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: String(index + 10),
        type: "video",
        url: `https://tos.test/${index + 10}.mp4`,
        mime: "video/mp4",
        size: 100,
        duration: 5,
      })),
    ];
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "305",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "边界混合参考",
          model_id: "doubao-seedance-2-0-260128",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          reference_asset_ids: assets.map((asset) => asset.id),
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-boundary",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue(assets),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-boundary",
      jobId: "305",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: assets.map((asset) => ({
          type: asset.type,
          url: asset.url,
        })),
      }),
    );
  });

  it.each([
    {
      name: "ten images",
      model: "doubao-seedance-2-0-260128",
      assets: Array.from({ length: 10 }, (_, index) => ({
        id: String(index + 1),
        type: "image",
        url: `https://tos.test/${index + 1}.png`,
        mime: "image/png",
      })),
      code: "reference_limit_exceeded",
    },
    {
      name: "four videos",
      model: "doubao-seedance-2-0-260128",
      assets: Array.from({ length: 4 }, (_, index) => ({
        id: String(index + 1),
        type: "video",
        url: `https://tos.test/${index + 1}.mp4`,
        mime: "video/mp4",
        size: 100,
        duration: 3,
      })),
      code: "reference_limit_exceeded",
    },
    {
      name: "video on a non-2.0 model",
      model: "doubao-seedance-1-5-pro-251215",
      assets: [{ id: "1", type: "video", url: "https://tos.test/1.mp4", mime: "video/mp4", size: 100, duration: 3 }],
      code: "unsupported_input",
    },
    {
      name: "audio Asset on a non-2.0 model (IKDJNZ audio reference)",
      model: "doubao-seedance-1-5-pro-251215",
      assets: [{ id: "1", type: "audio", url: "https://tos.test/1.mp3", mime: "audio/mpeg" }],
      code: "unsupported_input",
    },
    {
      name: "unsupported video MIME",
      model: "doubao-seedance-2-0-260128",
      assets: [{ id: "1", type: "video", url: "https://tos.test/1.webm", mime: "video/webm", size: 100, duration: 3 }],
      code: "invalid_reference_media",
    },
    {
      name: "video larger than 200 MB",
      model: "doubao-seedance-2-0-260128",
      assets: [{
        id: "1",
        type: "video",
        url: "https://tos.test/1.mp4",
        mime: "video/mp4",
        size: 200 * 1024 * 1024 + 1,
        duration: 3,
      }],
      code: "invalid_reference_media",
    },
    {
      name: "video shorter than two seconds",
      model: "doubao-seedance-2-0-260128",
      assets: [{ id: "1", type: "video", url: "https://tos.test/1.mp4", mime: "video/mp4", size: 100, duration: 1.9 }],
      code: "invalid_reference_media",
    },
    {
      name: "video with a side shorter than 300 pixels",
      model: "doubao-seedance-2-0-260128",
      assets: [{
        id: "1",
        type: "video",
        url: "https://tos.test/1.mp4",
        mime: "video/mp4",
        size: 100,
        width: 1280,
        height: 180,
        duration: 3,
      }],
      code: "invalid_reference_media",
    },
    {
      name: "video below the minimum total pixel count",
      model: "doubao-seedance-2-0-260128",
      assets: [{
        id: "1",
        type: "video",
        url: "https://tos.test/1.mp4",
        mime: "video/mp4",
        size: 100,
        width: 640,
        height: 360,
        duration: 3,
      }],
      code: "invalid_reference_media",
    },
    {
      name: "known total duration above 15 seconds",
      model: "doubao-seedance-2-0-260128",
      assets: [
        { id: "1", type: "video", url: "https://tos.test/1.mp4", mime: "video/mp4", size: 100, duration: 8 },
        { id: "2", type: "video", url: "https://tos.test/2.mov", mime: "video/quicktime", size: 100, duration: 8 },
      ],
      code: "invalid_reference_media",
    },
  ])("fails $name before provider submit", async ({ model, assets, code }) => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "303",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "非法参考素材",
          model_id: model,
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          reference_asset_ids: assets.map((asset) => asset.id),
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-invalid",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue(assets),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-invalid",
      jobId: "303",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).not.toHaveBeenCalled();
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code }),
    );
  });

  it.each([
    {
      name: "frame inputs mixed with ordinary references",
      input: {
        first_frame_asset_id: "1",
        reference_asset_ids: ["2"],
      },
    },
    {
      name: "a non-array reference_asset_ids value",
      input: {
        reference_asset_ids: "2",
      },
    },
  ])("rejects $name as invalid_video_inputs before provider submit", async ({ input }) => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "304",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "含糊输入",
          model_id: "doubao-seedance-2-0-260128",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          ...input,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-mixed",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-mixed",
      jobId: "304",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(repo.resolveInputAssets).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_reference" }),
    );
    // IK9VZ0 I5：派发前失败（未提交，无 providerTaskId）→ release_note = refund_confirmed
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNote: "refund_confirmed" }),
    );
  });

  it("persists the provider task id so another worker can resume polling", async () => {
    const module = await import("./video-job-runner.js").catch(() => ({}));
    const runVideoJobStep = (module as {
      runVideoJobStep?: (deps: Record<string, unknown>) => Promise<string | null>;
    }).runVideoJobStep;

    expect(runVideoJobStep).toBeTypeOf("function");
    if (!runVideoJobStep) return;

    const state: JobState = {
      status: "queued",
      providerTaskId: null,
      leaseOwner: null,
      fencingToken: 0,
      outputUrl: null,
    };
    const repo = {
      claimVideoJobById: vi.fn(async (jobId: string, workerId: string) => {
        expect(jobId).toBe("300");
        if (state.status === "succeeded" || state.leaseOwner) return null;
        state.leaseOwner = workerId;
        state.fencingToken += 1;
        return {
          id: "300",
          projectId: "55",
          userId: "9",
          input: {
            prompt: "鲸鱼游动",
            model_id: "seedance-2",
            aspect_ratio: "16:9",
            resolution: "720p",
            duration: 5,
            provider_credential: "sealed-token",
          },
          providerTaskId: state.providerTaskId,
          cancelRequested: false,
          workerId,
          fencingToken: state.fencingToken,
        };
      }),
      claimNextVideoJob: vi.fn(async (workerId: string) => {
        if (state.status === "succeeded" || state.leaseOwner) return null;
        state.leaseOwner = workerId;
        state.fencingToken += 1;
        return {
          id: "300",
          projectId: "55",
          userId: "9",
          input: {
            prompt: "鲸鱼游动",
            model_id: "seedance-2",
            aspect_ratio: "16:9",
            resolution: "720p",
            duration: 5,
            provider_credential: "sealed-token",
          },
          providerTaskId: state.providerTaskId,
          cancelRequested: false,
          workerId,
          fencingToken: state.fencingToken,
        };
      }),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(async (claim: { providerTaskId: string }) => {
        state.status = "processing";
        state.providerTaskId = claim.providerTaskId;
        state.leaseOwner = null;
        return true;
      }),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(async (result: { url: string }) => {
        state.status = "succeeded";
        state.outputUrl = result.url;
        state.leaseOwner = null;
        return true;
      }),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };
    const provider = {
      submit: vi.fn().mockResolvedValue({ taskId: "upstream-1", status: "queued" }),
      poll: vi.fn().mockResolvedValue({
        status: "succeeded",
        progress: 100,
        url: "https://provider.test/video.mp4",
        quota: 880000,
        error: null,
      }),
    };
    const credentialVault = {
      open: vi.fn().mockReturnValue("sk-user"),
    };
    const mediaRelay = {
      persist: vi.fn().mockResolvedValue({
        url: "https://bucket.test/generated/9/video/result.mp4",
        storageKey: "generated/9/video/result.mp4",
        mime: "video/mp4",
        size: 11,
      }),
    };
    const scheduleNext = vi.fn().mockResolvedValue(undefined);

    await runVideoJobStep({
      repo,
      workerId: "worker-1",
      jobId: "300",
      createProvider: () => provider,
      credentialVault,
      mediaRelay,
      scheduleNext,
      quotaToFen: (quota) => BigInt(Math.round(quota / 500_000 * 7.3 * 100)),
    });

    expect(state.providerTaskId).toBe("upstream-1");
    expect(state.status).toBe("processing");
    expect(provider.poll).not.toHaveBeenCalled();
    expect(repo.claimVideoJobById).toHaveBeenCalledWith("300", "worker-1");
    expect(repo.claimNextVideoJob).not.toHaveBeenCalled();
    expect(scheduleNext).toHaveBeenCalledWith("300", VIDEO_POLL_INTERVAL_MS);

    await runVideoJobStep({
      repo,
      workerId: "worker-2",
      jobId: "300",
      createProvider: () => provider,
      credentialVault,
      mediaRelay,
      scheduleNext,
      quotaToFen: (quota) => BigInt(Math.round(quota / 500_000 * 7.3 * 100)),
    });

    expect(repo.claimVideoJobById).toHaveBeenNthCalledWith(
      2,
      "300",
      "worker-2",
    );
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(provider.poll).toHaveBeenCalledWith("upstream-1");
    expect(mediaRelay.persist).toHaveBeenCalledWith(
      "https://provider.test/video.mp4",
      "9",
    );
    expect(state).toMatchObject({
      status: "succeeded",
      outputUrl: "https://bucket.test/generated/9/video/result.mp4",
    });
    expect(repo.publishVideoResult).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 5 }),
    );
    // IK7G9X：quota 880000 → fen = 880000/500000×7.3×100 = 1284.8 → round 1285n。
    expect(repo.publishVideoResult).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmountFen: 1285n }),
    );
  });

  it("schedules another RocketMQ step when the provider is still processing", async () => {
    const scheduleNext = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "300",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-1",
        cancelRequested: false,
        workerId: "worker-1",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn().mockResolvedValue(true),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    const { runVideoJobStep } = await import("./video-job-runner.js");
    await runVideoJobStep({
      repo,
      workerId: "worker-1",
      jobId: "300",
      createProvider: () => ({
        submit: vi.fn(),
        poll: vi.fn().mockResolvedValue({
          status: "processing",
          progress: 30,
          url: null,
          error: null,
        }),
      }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext,
    });

    expect(repo.rescheduleVideoPoll).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "300", progress: 30 }),
    );
    expect(scheduleNext).toHaveBeenCalledWith("300", VIDEO_POLL_INTERVAL_MS);
  });

  it("fails a never-settling provider task when poll count exceeds the cap", async () => {
    const scheduleNext = vi.fn().mockResolvedValue(undefined);
    const failVideoJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "300",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-1",
        cancelRequested: false,
        workerId: "worker-1",
        fencingToken: 1,
        pollCount: MAX_VIDEO_POLLS,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob,
      cancelVideoBeforeDispatch: vi.fn(),
    };

    const { runVideoJobStep } = await import("./video-job-runner.js");
    await runVideoJobStep({
      repo,
      workerId: "worker-1",
      jobId: "300",
      createProvider: () => ({
        submit: vi.fn(),
        poll: vi.fn().mockResolvedValue({
          status: "processing",
          progress: 30,
          url: null,
          error: null,
        }),
      }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext,
    });

    expect(failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "300", code: "provider_timeout" }),
    );
    expect(repo.rescheduleVideoPoll).not.toHaveBeenCalled();
    expect(scheduleNext).not.toHaveBeenCalled();
  });

  it("rejects inaccessible or cross-user input assets before any provider call", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "302",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "别人的素材不应可用",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "77",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-deny",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      // 跨用户/跨项目素材解析不到 → 返回空集合
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await expect(
      runVideoJobStep({
        repo,
        workerId: "worker-deny",
        jobId: "302",
        createProvider: () => ({ submit, poll: vi.fn() }),
        credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
        mediaRelay: { persist: vi.fn() },
        scheduleNext: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe("302");

    expect(repo.resolveInputAssets).toHaveBeenCalledWith(["77"], "9", "55");
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "reference_asset_unavailable" }),
    );
    expect(submit).not.toHaveBeenCalled();
    expect(repo.markVideoSubmitted).not.toHaveBeenCalled();
  });

  it("rejects non-image frame assets as unsupported before any provider call", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "303",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "首帧不是图片",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "88",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-type",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "88", type: "video", url: "https://tos.test/not-image.mp4" },
      ]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await expect(
      runVideoJobStep({
        repo,
        workerId: "worker-type",
        jobId: "303",
        createProvider: () => ({ submit, poll: vi.fn() }),
        credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
        mediaRelay: { persist: vi.fn() },
        scheduleNext: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe("303");

    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unsupported_input" }),
    );
    expect(submit).not.toHaveBeenCalled();
  });

});

describe("video job runner 实扣取证（IK9VZ0）", () => {
  it("task quota 缺失 → warn 告警（不再静默落 0），publish 仍正常完成", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const warns: string[] = [];
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "305",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "鲸鱼游动",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: "upstream-quota-missing",
        cancelRequested: false,
        workerId: "worker-quota",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn().mockResolvedValue(true),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };
    const provider = {
      submit: vi.fn(),
      poll: vi.fn().mockResolvedValue({
        status: "succeeded",
        progress: 100,
        url: "https://provider.test/video.mp4",
        // 无 quota 字段：取证失败场景
        error: null,
      }),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-quota",
      jobId: "305",
      createProvider: () => provider,
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: {
        persist: vi.fn().mockResolvedValue({
          url: "https://bucket.test/r.mp4",
          storageKey: "k",
          mime: "video/mp4",
          size: 1,
        }),
      },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
      quotaToFen: (quota) => BigInt(quota),
      warn: (msg: string) => warns.push(msg),
    });

    // quota 缺失必须告警（含 actual_amount_fen 落 0 语义）
    expect(warns.some((l) => l.includes("actual_amount_fen") && l.includes("0"))).toBe(true);
    // publish 正常完成，actual 落 0（不传 actualAmountFen）
    expect(repo.publishVideoResult).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "305", url: "https://bucket.test/r.mp4" }),
    );
    expect(repo.publishVideoResult).not.toHaveBeenCalledWith(
      expect.objectContaining({ actualAmountFen: expect.anything() }),
    );
  });

  it("终态 quota 与预留偏差超阈值 → warn 二次校验告警（不阻断 publish）", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const warns: string[] = [];
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "306",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "鲸鱼游动",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: "upstream-dev",
        cancelRequested: false,
        workerId: "worker-dev",
        fencingToken: 1,
        // 预留 1000 fen（quota 换算基准）
        reservedAmountFen: 1000n,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn().mockResolvedValue(true),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };
    const provider = {
      submit: vi.fn(),
      poll: vi.fn().mockResolvedValue({
        status: "succeeded",
        progress: 100,
        url: "https://provider.test/video.mp4",
        // quota=3000 → actualFen 3000n，reserved 1000n → 偏差 200% > 50% 阈值
        quota: 3000,
        error: null,
      }),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-dev",
      jobId: "306",
      createProvider: () => provider,
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: {
        persist: vi.fn().mockResolvedValue({
          url: "https://bucket.test/r.mp4",
          storageKey: "k",
          mime: "video/mp4",
          size: 1,
        }),
      },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
      quotaToFen: (quota) => BigInt(quota),
      warn: (msg: string) => warns.push(msg),
    });

    // 偏差超阈值必须告警
    expect(warns.some((l) => l.includes("偏差超阈值"))).toBe(true);
    // 不阻断：publish 携带实扣金额
    expect(repo.publishVideoResult).toHaveBeenCalledWith(
      expect.objectContaining({ actualAmountFen: 3000n }),
    );
  });
});

describe("video job runner material library references", () => {
  it("passes the material reference of an asset library in reference_material directives as asset://", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-material-refs", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "305",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "参考素材库图片",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          reference_materials: [
            { id: "Asset-img-1", type: "image" },
            { id: "Asset-vid-2", type: "video" },
          ],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-material-refs",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-material-refs",
      jobId: "305",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    // 素材库引用不查库（resolveInputAssets 空），转 asset:// 载体。
    expect(repo.resolveInputAssets).toHaveBeenCalledWith([], "9", "55");
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          { type: "image", url: "asset://Asset-img-1" },
          { type: "video", url: "asset://Asset-vid-2" },
        ],
      }),
    );
  });

  it("material library first frame yields asset:// firstFrameImage", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-material-ff", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "306",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "真人首帧",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_material_id: "Asset-face-1",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-material-ff",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-material-ff",
      jobId: "306",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstFrameImage: "asset://Asset-face-1",
        references: [],
      }),
    );
  });

  it("material library lowercase asset- id passes through to asset:// carrier", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-material-lc", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "308",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "真人首帧小写",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_material_id: "asset-20260820153209-6c9z8",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-material-lc",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-material-lc",
      jobId: "308",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstFrameImage: "asset://asset-20260820153209-6c9z8",
        references: [],
      }),
    );
  });

  it("frame mode cannot coexist with material references", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "307",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "首帧与参考并存",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "11",
          reference_materials: [{ id: "Asset-img-1", type: "image" }],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-material-mix",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-material-mix",
      jobId: "307",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).not.toHaveBeenCalled();
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_reference" }),
    );
  });

  it("a frame slot can only source from one of asset or material", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "308",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "首帧双来源",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "11",
          first_frame_material_id: "Asset-face-1",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-material-dual",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-material-dual",
      jobId: "308",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).not.toHaveBeenCalled();
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_reference" }),
    );
  });

  it("propagates provider error code on submit failure (IKBQEE: submit 阶段欠费识别)", async () => {
    const { runVideoJobStep, VideoProviderError } = await import(
      "./video-job-runner.js"
    );
    const submit = vi
      .fn()
      .mockRejectedValue(
        new VideoProviderError(
          "quota_exhausted",
          "预扣费额度失败, 用户剩余额度: ¥2.123294, 需要预扣费额度: ¥7.000000",
        ),
      );
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "309",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "小猫",
          model_id: "doubao-seedance-2-0-260128",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-submit-quota",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-submit-quota",
      jobId: "309",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "quota_exhausted" }),
    );
  });

  it("submit non-quota provider error keeps provider_failed code", async () => {
    const { runVideoJobStep, VideoProviderError } = await import(
      "./video-job-runner.js"
    );
    const submit = vi
      .fn()
      .mockRejectedValue(new VideoProviderError("provider_failed", "gateway down"));
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "310",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "测试",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-submit-nonquota",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-submit-nonquota",
      jobId: "310",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(submit).toHaveBeenCalledTimes(1);
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "provider_failed" }),
    );
  });

  it("poll-phase transport error falls back to provider_failed (不误判欠费)", async () => {
    const { runVideoJobStep, VideoProviderError } = await import(
      "./video-job-runner.js"
    );
    const poll = vi
      .fn()
      .mockRejectedValue(
        new VideoProviderError("provider_failed", "new-api 不可达"),
      );
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "311",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "轮询失败",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: "upstream-311",
        cancelRequested: false,
        workerId: "worker-poll-fail",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-poll-fail",
      jobId: "311",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(poll).toHaveBeenCalledTimes(1);
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "provider_failed" }),
    );
  });

  // IKEA26：poll 阶段瞬时网络错误（NewApiNetworkError/NewApiTimeoutError/5xx/429）不应 fail，
  // 走 rescheduleVideoPoll 继续轮询；4xx 业务错误仍 fail。第 3 层 retry job 复用父 job 上游结果。
  it("reschedules instead of failing when poll throws a transient network error (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const { NewApiError, NewApiNetworkError, NewApiTimeoutError } = await import(
      "@blue-whale/core"
    );
    const scheduleNext = vi.fn().mockResolvedValue(undefined);
    const rescheduleVideoPoll = vi.fn().mockResolvedValue(true);
    const failVideoJob = vi.fn().mockResolvedValue(true);
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new NewApiNetworkError("new-api 不可达"))
      .mockRejectedValueOnce(new NewApiTimeoutError("new-api 不可达"))
      .mockRejectedValueOnce(new NewApiError("upstream 503", 503))
      .mockRejectedValueOnce(new NewApiError("upstream 429", 429));
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "312",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-312",
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 25,
        parentProviderTaskId: null,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll,
      publishVideoResult: vi.fn(),
      failVideoJob,
      cancelVideoBeforeDispatch: vi.fn(),
    };
    const { runVideoJobStep: run } = await import("./video-job-runner.js");

    for (let i = 0; i < 4; i += 1) {
      await run({
        repo,
        workerId: "worker-ikea26",
        jobId: "312",
        createProvider: () => ({ submit: vi.fn(), poll }),
        credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
        mediaRelay: { persist: vi.fn() },
        scheduleNext,
      });
    }

    expect(poll).toHaveBeenCalledTimes(4);
    expect(rescheduleVideoPoll).toHaveBeenCalledTimes(4);
    expect(failVideoJob).not.toHaveBeenCalled();
    expect(rescheduleVideoPoll).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "312", progress: 25 }),
    );
    expect(scheduleNext).toHaveBeenCalledWith("312", VIDEO_POLL_INTERVAL_MS);
  });

  it("fails when poll throws a 4xx business error (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const { NewApiError } = await import("@blue-whale/core");
    const failVideoJob = vi.fn().mockResolvedValue(true);
    const rescheduleVideoPoll = vi.fn().mockResolvedValue(true);
    const poll = vi
      .fn()
      .mockRejectedValue(new NewApiError("上游视频任务不存在", 404));
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "313",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-313",
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 25,
        parentProviderTaskId: null,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll,
      publishVideoResult: vi.fn(),
      failVideoJob,
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "313",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
    });

    expect(failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "313", code: "provider_failed" }),
    );
    expect(rescheduleVideoPoll).not.toHaveBeenCalled();
  });

  it("fails when poll throws a 502 invalid_video_response contract error (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const { NewApiError } = await import("@blue-whale/core");
    const failVideoJob = vi.fn().mockResolvedValue(true);
    const rescheduleVideoPoll = vi.fn().mockResolvedValue(true);
    const poll = vi.fn().mockRejectedValue(
      new NewApiError("new-api 视频任务响应无效", 502, "invalid_video_response"),
    );
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "320",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-320",
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 25,
        parentProviderTaskId: null,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll,
      publishVideoResult: vi.fn(),
      failVideoJob,
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "320",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn(),
    });

    expect(failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "320", code: "provider_failed" }),
    );
    expect(rescheduleVideoPoll).not.toHaveBeenCalled();
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("fails when poll throws an unknown 5xx (501) not in transient whitelist (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const { NewApiError } = await import("@blue-whale/core");
    const failVideoJob = vi.fn().mockResolvedValue(true);
    const rescheduleVideoPoll = vi.fn().mockResolvedValue(true);
    const poll = vi.fn().mockRejectedValue(
      new NewApiError("upstream 501", 501),
    );
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "321",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token" },
        providerTaskId: "upstream-321",
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 25,
        parentProviderTaskId: null,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn(),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll,
      publishVideoResult: vi.fn(),
      failVideoJob,
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "321",
      createProvider: () => ({ submit: vi.fn(), poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn(),
    });

    expect(failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "321", code: "provider_failed" }),
    );
    expect(rescheduleVideoPoll).not.toHaveBeenCalled();
  });

  it("reuses parent upstream result on retry job instead of resubmitting (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const poll = vi.fn().mockResolvedValue({
      status: "succeeded",
      progress: 100,
      url: "https://tos.test/reused-video.mp4",
      error: null,
    });
    const persist = vi.fn().mockResolvedValue({
      url: "https://tos.test/reused-video.mp4",
      storageKey: "videos/reused.mp4",
      mime: "video/mp4",
      size: 12345,
    });
    const publishVideoResult = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "314",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试复用",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-314",
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult,
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "314",
      createProvider: () => ({ submit, poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist },
      scheduleNext: vi.fn(),
    });

    expect(poll).toHaveBeenCalledWith("upstream-parent-314");
    expect(submit).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledWith(
      "https://tos.test/reused-video.mp4",
      "9",
    );
    expect(publishVideoResult).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "314" }),
    );
  });

  it("warns on cost telemetry when reuse path has quota but reserved deviates (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const warn = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "317",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试复用偏差",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-317",
        // IK9VZ0：预留 100 fen，实扣经 quotaToFen 换算后远大于预留 → 偏差告警
        reservedAmountFen: 100n,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn().mockResolvedValue(true),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };
    const quotaToFen = vi.fn().mockReturnValue(10000n);

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "317",
      createProvider: () => ({
        submit: vi.fn(),
        poll: vi.fn().mockResolvedValue({
          status: "succeeded",
          progress: 100,
          url: "https://tos.test/reused-317.mp4",
          quota: 100,
          error: null,
        }),
      }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: {
        persist: vi.fn().mockResolvedValue({
          url: "https://tos.test/reused-317.mp4",
          storageKey: "videos/reused-317.mp4",
          mime: "video/mp4",
          size: 123,
        }),
      },
      quotaToFen,
      warn,
      scheduleNext: vi.fn(),
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("视频复用结果实扣与预留偏差超阈值"),
    );
  });

  it("resubmits on retry job when parent succeeded but returned no url (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "new-task", status: "queued" });
    const poll = vi.fn().mockResolvedValue({
      status: "succeeded",
      progress: 100,
      url: null,
      error: null,
    });
    const markVideoSubmitted = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "318",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试成功无url",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-318",
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted,
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "318",
      createProvider: () => ({ submit, poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn(),
    });

    expect(poll).toHaveBeenCalledWith("upstream-parent-318");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(markVideoSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ providerTaskId: "new-task" }),
    );
  });

  it("resubmits on retry job when reuse publish fails (fencing race, IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "new-task", status: "queued" });
    const poll = vi.fn().mockResolvedValue({
      status: "succeeded",
      progress: 100,
      url: "https://tos.test/reused-319.mp4",
      error: null,
    });
    const persist = vi.fn().mockResolvedValue({
      url: "https://tos.test/reused-319.mp4",
      storageKey: "videos/reused-319.mp4",
      mime: "video/mp4",
      size: 123,
    });
    const publishVideoResult = vi.fn().mockResolvedValue(false);
    const markVideoSubmitted = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "319",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试复用publish失败",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-319",
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted,
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult,
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "319",
      createProvider: () => ({ submit, poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist },
      scheduleNext: vi.fn(),
    });

    // publish 返回 false → 视为未复用 → 重新 submit（防 job 无终态悬挂）
    expect(submit).toHaveBeenCalledTimes(1);
    expect(markVideoSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ providerTaskId: "new-task" }),
    );
  });

  it("resubmits on retry job when parent upstream failed or missing (IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "new-task", status: "queued" });
    const poll = vi.fn().mockResolvedValue({
      status: "failed",
      progress: 100,
      url: null,
      error: { code: "provider_failed", message: "上游失败" },
    });
    const markVideoSubmitted = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "315",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试上游失败",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-315",
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted,
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "315",
      createProvider: () => ({ submit, poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn(),
    });

    expect(poll).toHaveBeenCalledWith("upstream-parent-315");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(markVideoSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ providerTaskId: "new-task" }),
    );
  });

  it("resubmits on retry job when parent upstream query fails (D6, IKEA26)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const { NewApiNetworkError } = await import("@blue-whale/core");
    const submit = vi.fn().mockResolvedValue({ taskId: "new-task", status: "queued" });
    const poll = vi.fn().mockRejectedValue(new NewApiNetworkError("new-api 不可达"));
    const markVideoSubmitted = vi.fn().mockResolvedValue(true);
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "316",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "重试查上游失败",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikea26",
        fencingToken: 1,
        pollCount: 0,
        progress: 0,
        parentProviderTaskId: "upstream-parent-316",
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted,
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikea26",
      jobId: "316",
      createProvider: () => ({ submit, poll }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn(),
    });

    expect(poll).toHaveBeenCalledWith("upstream-parent-316");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(markVideoSubmitted).toHaveBeenCalledWith(
      expect.objectContaining({ providerTaskId: "new-task" }),
    );
  });
});

describe("video job runner asset↔material link (IKDJNZ)", () => {
  it("linked reference asset converts to material reference (asset://), unlinked keeps url", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "ikdjnz-linked-refs", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "401",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "关联参考",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          reference_asset_ids: ["11", "12"],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-refs",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/a.png", material_id: "asset-linked-1" },
        { id: "12", type: "image", url: "https://tos.test/b.png", material_id: null },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-refs",
      jobId: "401",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    // 关联的 11 转 asset://，未关联的 12 保留本地 url（master 排序：本地在前、素材库在后）。
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          { type: "image", url: "https://tos.test/b.png" },
          { type: "image", url: "asset://asset-linked-1" },
        ],
      }),
    );
  });

  it("dedups merged material ids across explicit and linked refs (first occurrence wins)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "ikdjnz-dedup", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "402",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "去重",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          reference_asset_ids: ["11"],
          reference_materials: [
            { id: "asset-same", type: "image" },
            { id: "asset-other", type: "video" },
          ],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-dedup",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/a.png", material_id: "asset-same" },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-dedup",
      jobId: "402",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    // asset-same 同时出现在显式素材库引用与关联转换，只保留一次。
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          { type: "image", url: "asset://asset-same" },
          { type: "video", url: "asset://asset-other" },
        ],
      }),
    );
  });

  it("linked first frame asset resolves to material asset:// first frame", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "ikdjnz-linked-ff", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "403",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "关联首帧",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "11",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-ff",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/first.png", material_id: "asset-face-1" },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-ff",
      jobId: "403",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        firstFrameImage: "asset://asset-face-1",
        references: [],
      }),
    );
  });

  it("linked non-image (video) first frame asset is rejected (首尾帧必须图片)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn();
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "404",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "关联视频首帧",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          first_frame_asset_id: "11",
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-ff-video",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "video", url: "https://tos.test/first.mp4", material_id: "asset-vid-1" },
      ]),
      markVideoSubmitted: vi.fn(),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn().mockResolvedValue(true),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-ff-video",
      jobId: "404",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).not.toHaveBeenCalled();
    expect(repo.failVideoJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unsupported_input" }),
    );
  });

  it("single references array preserves order across asset and material (IKDJNZ)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "ikdjnz-single-refs", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "405",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "单数组保序",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          references: [
            { role: "first_frame", asset_id: "11", type: "image" },
            { role: "reference", material_id: "asset-mat-1", type: "image" },
            { role: "reference", asset_id: "12", type: "image" },
            { role: "last_frame", material_id: "asset-last-1", type: "image" },
          ],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-single-refs",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/f.png", material_id: null },
        { id: "12", type: "image", url: "https://tos.test/r.png", material_id: null },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-single-refs",
      jobId: "405",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        // 单数组语义：帧作为带 role 的 reference 条目在前，普通参考随后（未关联本地在前、素材库在后）。
        references: [
          { type: "image", url: "https://tos.test/f.png", role: "first_frame" },
          { type: "image", url: "asset://asset-last-1", role: "last_frame" },
          { type: "image", url: "https://tos.test/r.png" },
          { type: "image", url: "asset://asset-mat-1" },
        ],
      }),
    );
  });

  it("single references array with audio reference maps to audio url and keeps order (IKDJNZ)", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "ikdjnz-audio-ref", status: "queued" });
    const repo = {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "406",
        projectId: "55",
        userId: "9",
        input: {
          prompt: "单数组参考音频",
          model_id: "seedance-2",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 5,
          references: [
            { role: "first_frame", asset_id: "11", type: "image" },
            { role: "reference", asset_id: "13", type: "audio" },
            { role: "reference", material_id: "asset-audio-1", type: "audio" },
            { role: "last_frame", material_id: "asset-last-1", type: "image" },
          ],
          provider_credential: "sealed-token",
        },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-ikdjnz-audio-ref",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([
        { id: "11", type: "image", url: "https://tos.test/f.png", material_id: null },
        { id: "13", type: "audio", url: "https://tos.test/1.mp3", material_id: null },
      ]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };

    await runVideoJobStep({
      repo,
      workerId: "worker-ikdjnz-audio-ref",
      jobId: "406",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        references: [
          { type: "image", url: "https://tos.test/f.png", role: "first_frame" },
          { type: "image", url: "asset://asset-last-1", role: "last_frame" },
          // 未关联本地资源在前、素材库引用在后（master 排序）。
          { type: "audio", url: "https://tos.test/1.mp3" },
          { type: "audio", url: "asset://asset-audio-1" },
        ],
      }),
    );
  });
});
// IKDLQG：目标驱动视频任务——提交时把冻结的 text_attachments 快照按契约确定性组合进 provider prompt。
// 快照即事实来源：runner 不回读来源节点；无该字段的存量任务 prompt 逐字节不变（见上文既有用例）。
describe("video job runner 文本附件快照（IKDLQG）", () => {
  function buildAttachmentRepo(input: Record<string, unknown>) {
    return {
      claimVideoJobById: vi.fn().mockResolvedValue({
        id: "401",
        projectId: "55",
        userId: "9",
        input: { provider_credential: "sealed-token", ...input },
        providerTaskId: null,
        cancelRequested: false,
        workerId: "worker-attachments",
        fencingToken: 1,
      }),
      claimNextVideoJob: vi.fn(),
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      markVideoSubmitted: vi.fn().mockResolvedValue(true),
      rescheduleVideoPoll: vi.fn(),
      publishVideoResult: vi.fn(),
      failVideoJob: vi.fn(),
      cancelVideoBeforeDispatch: vi.fn(),
    };
  }

  it("仅附件正文（prompt 为空串）→ submit prompt 由附件组合", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-attach", status: "queued" });
    const repo = buildAttachmentRepo({
      prompt: "",
      target_node_id: "media-2",
      text_attachments: [
        { node_id: "text-a", title: "风格", text: "赛博朋克" },
        { node_id: "text-b", title: "", text: "雨夜" },
      ],
      model_id: "doubao-seedance-2-0-260128",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 8,
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-attachments",
      jobId: "401",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "赛博朋克\n\n雨夜" }),
    );
  });

  it("附件加目标提示词 → 附件按序在前、目标提示词最后；空白附件忽略", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-mixed", status: "queued" });
    const repo = buildAttachmentRepo({
      prompt: "人物走过街角",
      target_node_id: "media-2",
      text_attachments: [
        { node_id: "text-blank", title: "空白", text: "   " },
        { node_id: "text-a", title: "风格", text: "赛博朋克" },
      ],
      model_id: "doubao-seedance-2-0-260128",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 8,
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-attachments",
      jobId: "401",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "赛博朋克\n\n人物走过街角" }),
    );
  });

  // IKDLQH：排序后的快照——submit prompt 严格跟随快照数组顺序（非 node_id/标题排序），钉住「供应商请求顺序=快照顺序」。
  it("快照数组为非默认顺序时 submit prompt 精确跟随（IKDLQH 顺序钉扎）", async () => {
    const { runVideoJobStep } = await import("./video-job-runner.js");
    const submit = vi.fn().mockResolvedValue({ taskId: "upstream-reordered", status: "queued" });
    const repo = buildAttachmentRepo({
      prompt: "目标提示词",
      target_node_id: "media-2",
      text_attachments: [
        { node_id: "text-z", title: "乙", text: "正文乙" },
        { node_id: "text-a", title: "甲", text: "正文甲" },
      ],
      model_id: "doubao-seedance-2-0-260128",
      aspect_ratio: "16:9",
      resolution: "720p",
      duration: 8,
    });

    await runVideoJobStep({
      repo,
      workerId: "worker-attachments",
      jobId: "401",
      createProvider: () => ({ submit, poll: vi.fn() }),
      credentialVault: { open: vi.fn().mockReturnValue("sk-user") },
      mediaRelay: { persist: vi.fn() },
      scheduleNext: vi.fn().mockResolvedValue(undefined),
    });

    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "正文乙\n\n正文甲\n\n目标提示词" }),
    );
  });
});
