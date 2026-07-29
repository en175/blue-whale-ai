import { describe, expect, it, vi } from "vitest";

type JobState = {
  status: "queued" | "processing" | "succeeded";
  providerTaskId: string | null;
  leaseOwner: string | null;
  fencingToken: number;
  outputUrl: string | null;
};

describe("video job runner recovery", () => {
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
    });

    expect(state.providerTaskId).toBe("upstream-1");
    expect(state.status).toBe("processing");
    expect(provider.poll).not.toHaveBeenCalled();
    expect(repo.claimVideoJobById).toHaveBeenCalledWith("300", "worker-1");
    expect(repo.claimNextVideoJob).not.toHaveBeenCalled();
    expect(scheduleNext).toHaveBeenCalledWith("300", 2_000);

    await runVideoJobStep({
      repo,
      workerId: "worker-2",
      jobId: "300",
      createProvider: () => provider,
      credentialVault,
      mediaRelay,
      scheduleNext,
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
  });

  it("schedules another BullMQ step when the provider is still processing", async () => {
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
    expect(scheduleNext).toHaveBeenCalledWith("300", 2_000);
  });
});
