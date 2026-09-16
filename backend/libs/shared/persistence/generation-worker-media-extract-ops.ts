// IKARDY：媒体提取（视频→音频）短步骤写操作——进度回写、结果发布（建 audio 资产）、失败。
// 免费工具：无 cost_reservations / generation_output_slots 逻辑（对齐视频但精简）。
// IKFS5W：不写画布（原 updateMediaExtractNodeToAudio / failMediaExtractNode 已删）。
import type { PrismaClient } from "@prisma/client";

import { appendProjectEvent } from "./product-event-repo.js";
import { imageJobLeaseSeconds } from "./generation-worker-internals.js";
import type { WorkerRepo } from "./generation-worker-types.js";

export function createWorkerMediaExtractOps(
  prisma: PrismaClient,
): Pick<
  WorkerRepo,
  | "updateMediaExtractProgress"
  | "publishMediaExtractResult"
  | "failMediaExtractJob"
> {
  // 进度心跳续租用：与 claim 同一租约时长。
  const LEASE_SECONDS = imageJobLeaseSeconds();
  return {
    async updateMediaExtractProgress(input) {
      // IKARDY 审查修复：每次进度写同时续租（心跳），长下载/长提取不因 120s 租约过期被重投。
      const updated = await prisma.generation_jobs.updateMany({
        where: {
          id: BigInt(input.jobId),
          status: "processing",
          lease_owner: input.workerId,
          fencing_token: BigInt(input.fencingToken),
        },
        data: {
          progress: Math.max(0, Math.min(99, Math.round(input.progress))),
          last_polled_at: new Date(),
          lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000),
          version: { increment: 1 },
        },
      });
      return updated.count === 1;
    },

    async publishMediaExtractResult(input) {
      return prisma.$transaction(async (tx) => {
        const owned = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: "processing",
            lease_owner: input.workerId,
            fencing_token: BigInt(input.fencingToken),
          },
          data: {
            status: "succeeded",
            progress: 100,
            next_action_at: null,
            next_poll_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (owned.count !== 1) return false;

        const asset = await tx.assets.create({
          data: {
            user_id: BigInt(input.userId),
            project_id: BigInt(input.projectId),
            generation_job_id: BigInt(input.jobId),
            type: "audio",
            url: input.url,
            storage_key: input.storageKey,
            mime: input.mime,
            size: BigInt(input.size),
            // E 层合并后只有 duration_ms（毫秒，消费端优先）：ffmpeg 给秒浮点，×1000 取整。
            duration_ms:
              input.duration === null || input.duration === undefined
                ? null
                : Math.round(input.duration * 1000),
            source: "generated",
            status: "normal",
          },
        });
        await tx.generation_jobs.update({
          where: { id: BigInt(input.jobId) },
          data: { output_asset_ids: [Number(asset.id)] },
        });
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "succeeded",
            status: "succeeded",
            message: "音频已提取",
            payload: { asset_ids: [asset.id.toString()] },
          } as never,
        });

        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(input.jobId) },
        });
        if (job?.project_id !== null && job?.project_id !== undefined) {
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "asset.created",
            aggregateType: "asset",
            aggregateId: asset.id.toString(),
            aggregateVersion: asset.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              asset_id: asset.id.toString(),
              generation_job_id: job.id.toString(),
              type: asset.type,
              access_url: asset.url,
            },
          });
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "generation_job.status_changed",
            aggregateType: "generation_job",
            aggregateId: job.id.toString(),
            aggregateVersion: job.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              job_id: job.id.toString(),
              type: job.type,
              source: job.source,
              status: job.status,
              progress: job.progress,
              output_asset_ids: [asset.id.toString()],
            },
          });
        }
        return true;
      });
    },

    async failMediaExtractJob(input) {
      return prisma.$transaction(async (tx) => {
        const updated = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: "processing",
            lease_owner: input.workerId,
            fencing_token: BigInt(input.fencingToken),
          },
          data: {
            status: "failed",
            error: {
              code: input.code,
              message: input.message,
              ...(input.details !== undefined ? { details: input.details } : {}),
            } as never,
            next_action_at: null,
            next_poll_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(input.jobId) },
        });
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: BigInt(input.jobId),
            event: "failed",
            status: "failed",
            message: `${input.code}: ${input.message}`,
          },
        });
        if (job?.project_id !== null && job?.project_id !== undefined) {
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "generation_job.status_changed",
            aggregateType: "generation_job",
            aggregateId: job.id.toString(),
            aggregateVersion: job.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              job_id: job.id.toString(),
              type: job.type,
              source: job.source,
              status: job.status,
              progress: job.progress,
              error: { code: input.code, message: input.message },
            },
          });
        }
        return true;
      });
    },
  };
}
