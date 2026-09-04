// IKARDY：媒体提取（视频→音频）短步骤。免费工具：无 provider/cost。
// 编排：claim-by-id → 解析源资产 → 下载 → ffmpeg 抽音轨 → 上传 TOS → 发布资产。
// 下载/提取/上传都是注入端口，本文件保持包纯净（无 ffmpeg/TOS 依赖）。
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "@blue-whale/core/logging";
import {
  ERROR_INVALID_INPUT,
  ERROR_MEDIA_EXTRACT_FAILED,
  ERROR_SOURCE_ASSET_UNAVAILABLE,
} from "@blue-whale/contracts";

const logger = createLogger("generation-runtime");

export type MediaExtractClaim = {
  id: string;
  projectId: string;
  userId: string;
  input: Record<string, unknown>;
  workerId: string;
  fencingToken: number;
};

export interface MediaExtractRunnerRepo {
  claimMediaExtractJobById(
    jobId: string,
    workerId: string,
  ): Promise<MediaExtractClaim | null>;
  updateMediaExtractProgress(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    progress: number;
  }): Promise<boolean>;
  publishMediaExtractResult(input: {
    jobId: string;
    projectId: string;
    userId: string;
    workerId: string;
    fencingToken: number;
    url: string;
    storageKey: string;
    mime: string;
    size: number;
    duration: number | null;
  }): Promise<boolean>;
  failMediaExtractJob(input: {
    jobId: string;
    workerId: string;
    fencingToken: number;
    code: string;
    message: string;
    /** IKBQEE / ADR-0078：调试详情，落 error.details，禁展示用户。 */
    details?: Record<string, unknown>;
  }): Promise<boolean>;
  /** 提取成功：把画布占位节点更新为最终音频节点（IKARDY）。 */
  updateMediaExtractNodeToAudio(input: {
    jobId: string;
    projectId: string;
    url: string;
    mime: string;
    size: number;
    duration: number | null;
  }): Promise<boolean>;
  /** 提取失败：把画布占位节点置 failed（IKARDY）。 */
  failMediaExtractNode(input: {
    jobId: string;
    projectId: string;
    code: string;
    message: string;
  }): Promise<boolean>;
  resolveMediaExtractSource(
    assetId: string,
    userId: string,
    projectId: string,
  ): Promise<{ storageKey: string; mime: string | null; url: string } | null>;
}

/** 下载端口：按公网 url（资产 public-read）下载视频到 outputPath，超 maxBytes 抛错。onProgress(0-100) 回调下载进度（用于续租心跳）。 */
export interface MediaExtractDownloader {
  download(input: {
    url: string;
    outputPath: string;
    maxBytes: number;
    onProgress?: (percent: number) => void;
  }): Promise<void>;
}

/** 提取端口：ffmpeg 抽音轨出 mp3，onProgress(0-100) 回调提取百分比。 */
export interface MediaExtractWorker {
  extract(input: {
    inputPath: string;
    outputPath: string;
    onProgress: (percent: number) => void;
  }): Promise<{ duration: number | null }>;
}

/** 上传端口：把 mp3 文件上传到 TOS 并设 public-read，返回存储结果。 */
export interface MediaExtractUploader {
  upload(input: {
    filePath: string;
    userId: string;
    mime: string;
  }): Promise<{ url: string; storageKey: string; mime: string; size: number }>;
}

export interface RunMediaExtractStepDeps {
  repo: MediaExtractRunnerRepo;
  workerId: string;
  jobId: string;
  download: MediaExtractDownloader;
  extract: MediaExtractWorker;
  upload: MediaExtractUploader;
  /** 下载大小上限，缺省 200MiB（对齐 tos-video-media-relay）。 */
  maxVideoBytes?: number;
}

/** 可预期的输入错误（无音轨等）：按 code 落 error JSON，不判为系统失败。 */
export class MediaExtractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MediaExtractError";
  }
}

/** 前端阶段映射基准：0=排队，1-20=下载，21-90=提取，91-99=上传，100=完成。 */
const DOWNLOAD_DONE_PROGRESS = 20;
const EXTRACT_PROGRESS_RANGE = 70;
const UPLOAD_START_PROGRESS = 91;

async function failMediaExtract(
  repo: MediaExtractRunnerRepo,
  claim: MediaExtractClaim,
  code: string,
  message: string,
): Promise<void> {
  await repo.failMediaExtractJob({
    jobId: claim.id,
    workerId: claim.workerId,
    fencingToken: claim.fencingToken,
    code,
    message,
    // IKBQEE / ADR-0078：调试详情（provider 原文等）进 error.details，禁展示用户。
    details: { raw: message },
  });
  // 画布占位节点置 failed（best-effort，失败不阻断）。
  await repo
    .failMediaExtractNode({
      jobId: claim.id,
      projectId: claim.projectId,
      code,
      message,
    })
    .catch(() => {});
}

async function updateProgress(
  repo: MediaExtractRunnerRepo,
  claim: MediaExtractClaim,
  progress: number,
): Promise<void> {
  await repo.updateMediaExtractProgress({
    jobId: claim.id,
    workerId: claim.workerId,
    fencingToken: claim.fencingToken,
    progress,
  });
}

/** 运行一步媒体提取。返回 jobId（claim 成功），或 null（无可认领 / 重复唤醒）。 */
export async function runMediaExtractStep(
  deps: RunMediaExtractStepDeps,
): Promise<string | null> {
  // IKC9EJ：claim 必须在 try 外保持抛错→consumer 不 ack 重投的语义（瞬时 DB 错误不应落 failed，
  // 否则把健康 job 判死）；但抛错时不落 failed 也不被下方 catch 记录 → job 永久 queued 且无日志。
  // 这里补日志抓实锤（瞬时 DB/Prisma 错误 vs 持久错误），错误文本此前被容器重建冲掉无法复现。
  let claim: MediaExtractClaim | null;
  try {
    claim = await deps.repo.claimMediaExtractJobById(
      deps.jobId,
      deps.workerId,
    );
  } catch (error) {
    logger.error(
      `runMediaExtractStep claim 失败 jobId=${deps.jobId}: ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
    throw error; // 保持不 ack → RocketMQ 重投；DB 侧 RecoveryService 兜底捞回。
  }
  if (!claim) return null;

  const maxVideoBytes = deps.maxVideoBytes ?? 200 * 1024 * 1024;
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const inputPath = join(tmpdir(), `me-${runId}-in`);
  const outputPath = join(tmpdir(), `me-${runId}-out.mp3`);

  try {
    const sourceAssetId = claim.input.source_asset_id;
    const sourceAssetIdStr =
      typeof sourceAssetId === "string" || typeof sourceAssetId === "number"
        ? String(sourceAssetId)
        : "";
    if (!sourceAssetIdStr) {
      await failMediaExtract(deps.repo, claim, ERROR_INVALID_INPUT, "缺少源视频资产 id");
      return claim.id;
    }

    const source = await deps.repo.resolveMediaExtractSource(
      sourceAssetIdStr,
      claim.userId,
      claim.projectId,
    );
    if (!source) {
      await failMediaExtract(
        deps.repo,
        claim,
        ERROR_SOURCE_ASSET_UNAVAILABLE,
        "源视频资产不可用",
      );
      return claim.id;
    }

    await deps.download.download({
      url: source.url,
      outputPath: inputPath,
      maxBytes: maxVideoBytes,
      // 下载进度映射到 1-20 带；每次 updateMediaExtractProgress 续租（心跳），长下载不因租约过期被重投。
      onProgress: (percent) => {
        const mapped = Math.max(
          1,
          Math.min(
            DOWNLOAD_DONE_PROGRESS - 1,
            1 + (Math.max(0, Math.min(100, percent)) / 100) * (DOWNLOAD_DONE_PROGRESS - 2),
          ),
        );
        void updateProgress(deps.repo, claim, mapped);
      },
    });
    await updateProgress(deps.repo, claim, DOWNLOAD_DONE_PROGRESS);

    const { duration } = await deps.extract.extract({
      inputPath,
      outputPath,
      onProgress: (percent) => {
        const mapped = Math.min(
          DOWNLOAD_DONE_PROGRESS + EXTRACT_PROGRESS_RANGE,
          DOWNLOAD_DONE_PROGRESS +
            (EXTRACT_PROGRESS_RANGE * Math.max(0, Math.min(100, percent))) /
              100,
        );
        void updateProgress(deps.repo, claim, mapped);
      },
    });
    await updateProgress(deps.repo, claim, UPLOAD_START_PROGRESS);

    const stored = await deps.upload.upload({
      filePath: outputPath,
      userId: claim.userId,
      mime: "audio/mpeg",
    });
    const published = await deps.repo.publishMediaExtractResult({
      jobId: claim.id,
      projectId: claim.projectId,
      userId: claim.userId,
      workerId: claim.workerId,
      fencingToken: claim.fencingToken,
      url: stored.url,
      storageKey: stored.storageKey,
      mime: stored.mime,
      size: stored.size,
      duration,
    });
    if (!published) {
      logger.warn(
        `runMediaExtractStep 发布守卫失败 jobId=${claim.id}（stale worker 或已终态）`,
      );
    } else {
      // 更新画布占位节点为最终音频节点（失败不阻断任务成功）。
      await deps.repo
        .updateMediaExtractNodeToAudio({
          jobId: claim.id,
          projectId: claim.projectId,
          url: stored.url,
          mime: stored.mime,
          size: stored.size,
          duration,
        })
        .catch((error) => {
          logger.warn(
            `runMediaExtractStep 画布节点更新失败 jobId=${claim.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    }
    return claim.id;
  } catch (error) {
    const code =
      error instanceof MediaExtractError ? error.code : ERROR_MEDIA_EXTRACT_FAILED;
    const message =
      error instanceof Error ? error.message : "媒体提取失败";
    if (error instanceof Error) {
      logger.error(
        `runMediaExtractStep 异常 jobId=${claim.id} code=${code}: ${error.stack ?? error.message}`,
      );
    } else {
      logger.error(`runMediaExtractStep 异常 jobId=${claim.id} code=${code}: ${String(error)}`);
    }
    await failMediaExtract(deps.repo, claim, code, message);
    return claim.id;
  } finally {
    // 尽力清理临时文件，失败不影响主流程。
    for (const path of [inputPath, outputPath]) {
      await import("node:fs/promises")
        .then((fs) => fs.rm(path, { force: true }).catch(() => {}))
        .catch(() => {});
    }
  }
}
