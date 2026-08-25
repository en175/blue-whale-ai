import { describe, expect, it, vi } from "vitest";

import {
  MediaExtractError,
  runMediaExtractStep,
  type MediaExtractDownloader,
  type MediaExtractRunnerRepo,
  type MediaExtractWorker,
} from "./media-extract-runner.js";

const BASE_CLAIM = {
  id: "400",
  projectId: "55",
  userId: "9",
  workerId: "worker-1",
  fencingToken: 2,
  input: { source_asset_id: "88" },
};

function makeRepo(overrides: Partial<MediaExtractRunnerRepo> = {}): MediaExtractRunnerRepo {
  return {
    claimMediaExtractJobById: vi.fn().mockResolvedValue(BASE_CLAIM),
    updateMediaExtractProgress: vi.fn().mockResolvedValue(true),
    publishMediaExtractResult: vi.fn().mockResolvedValue(true),
    failMediaExtractJob: vi.fn().mockResolvedValue(true),
    failMediaExtractNode: vi.fn().mockResolvedValue(true),
    updateMediaExtractNodeToAudio: vi.fn().mockResolvedValue(true),
    resolveMediaExtractSource: vi
      .fn()
      .mockResolvedValue({
        storageKey: "uploads/9/video/input.mp4",
        mime: "video/mp4",
        url: "https://bucket.test/uploads/9/video/input.mp4",
      }),
    ...overrides,
  };
}

/** 每测试新建端口，避免 mock 调用计数跨测试污染。 */
function makePorts(overrides: {
  download?: MediaExtractDownloader;
  extract?: MediaExtractWorker;
  upload?: { upload: ReturnType<typeof vi.fn> };
} = {}) {
  const download: MediaExtractDownloader = overrides.download ?? {
    download: vi.fn().mockResolvedValue(undefined),
  };
  const extract: MediaExtractWorker = overrides.extract ?? {
    extract: vi.fn().mockResolvedValue({ duration: 8 }),
  };
  const upload = overrides.upload ?? {
    upload: vi.fn().mockResolvedValue({
      url: "https://bucket.test/out.mp3",
      storageKey: "media-extract/9/audio/out.mp3",
      mime: "audio/mpeg",
      size: 1024,
    }),
  };
  return { download, extract, upload };
}

describe("runMediaExtractStep", () => {
  it("returns null when nothing to claim", async () => {
    const repo = makeRepo({ claimMediaExtractJobById: vi.fn().mockResolvedValue(null) });
    const { download, extract, upload } = makePorts();
    await expect(
      runMediaExtractStep({ repo, workerId: "w", jobId: "400", download, extract, upload }),
    ).resolves.toBeNull();
  });

  it("runs download → extract → upload → publish on the happy path", async () => {
    const repo = makeRepo();
    const { download, extract, upload } = makePorts();
    await expect(
      runMediaExtractStep({ repo, workerId: "worker-1", jobId: "400", download, extract, upload }),
    ).resolves.toBe("400");

    expect(download.download).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bucket.test/uploads/9/video/input.mp4",
        outputPath: expect.stringContaining("me-"),
        maxBytes: 200 * 1024 * 1024,
        onProgress: expect.any(Function),
      }),
    );
    expect(extract.extract).toHaveBeenCalled();
    expect(upload.upload).toHaveBeenCalledWith({
      filePath: expect.stringContaining("out.mp3"),
      userId: "9",
      mime: "audio/mpeg",
    });
    expect(repo.publishMediaExtractResult).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "400",
        url: "https://bucket.test/out.mp3",
        duration: 8,
      }),
    );
    expect(repo.updateMediaExtractNodeToAudio).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "400", url: "https://bucket.test/out.mp3" }),
    );
  });

  it("fails with video_has_no_audio_track when ffmpeg reports no audio stream", async () => {
    const repo = makeRepo();
    const { download, upload } = makePorts();
    const noAudioExtract: MediaExtractWorker = {
      extract: vi.fn().mockRejectedValue(
        new MediaExtractError("video_has_no_audio_track", "视频没有音轨"),
      ),
    };
    await runMediaExtractStep({ repo, workerId: "worker-1", jobId: "400", download, extract: noAudioExtract, upload });
    expect(repo.failMediaExtractJob).toHaveBeenCalledWith({
      jobId: "400",
      workerId: "worker-1",
      fencingToken: 2,
      code: "video_has_no_audio_track",
      message: "视频没有音轨",
    });
    expect(repo.publishMediaExtractResult).not.toHaveBeenCalled();
  });

  it("fails with source_asset_unavailable when the source asset is missing", async () => {
    const repo = makeRepo({ resolveMediaExtractSource: vi.fn().mockResolvedValue(null) });
    const { download, extract, upload } = makePorts();
    await runMediaExtractStep({ repo, workerId: "w", jobId: "400", download, extract, upload });
    expect(repo.failMediaExtractJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "source_asset_unavailable" }),
    );
    expect(download.download).not.toHaveBeenCalled();
  });

  it("fails with video_too_large when download exceeds the cap", async () => {
    const repo = makeRepo();
    const { extract, upload } = makePorts();
    const tooLargeDownload: MediaExtractDownloader = {
      download: vi
        .fn()
        .mockRejectedValue(new MediaExtractError("video_too_large", "视频超过大小上限")),
    };
    await runMediaExtractStep({ repo, workerId: "w", jobId: "400", download: tooLargeDownload, extract, upload });
    expect(repo.failMediaExtractJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "video_too_large" }),
    );
  });

  it("fails with invalid_input when source_asset_id is missing", async () => {
    const repo = makeRepo({
      claimMediaExtractJobById: vi.fn().mockResolvedValue({ ...BASE_CLAIM, input: {} }),
    });
    const { download, extract, upload } = makePorts();
    await runMediaExtractStep({ repo, workerId: "w", jobId: "400", download, extract, upload });
    expect(repo.failMediaExtractJob).toHaveBeenCalledWith(
      expect.objectContaining({ code: "invalid_input" }),
    );
  });
});
