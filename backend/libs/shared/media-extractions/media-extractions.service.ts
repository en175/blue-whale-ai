// IKARDY：媒体提取（视频→音频）建任务服务。校验视频资产归属 → 插 generation_jobs(type=media_extract)。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import { placeMediaExtractPendingNode } from "@blue-whale/persistence";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const SUPPORTED_FORMATS = new Set(["mp3"]);

@Injectable()
export class MediaExtractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: { source_asset_id?: unknown; output_format?: unknown },
  ) {
    const sourceAssetId =
      typeof body.source_asset_id === "number" ||
      typeof body.source_asset_id === "string"
        ? String(body.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }
    const outputFormat =
      typeof body.output_format === "string" &&
      SUPPORTED_FORMATS.has(body.output_format)
        ? body.output_format
        : "mp3";

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    const asset = await this.assets.findAccessible(projectId, sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持从视频资产提取音频");
    }

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: "media_extract",
        source: "dock",
        status: "queued",
        progress: 0,
        expected_output_count: 1,
        input: { source_asset_id: sourceAssetId, output_format: outputFormat },
        // 过去 60s：media_extract 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
        // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，任务悬挂（media_extract 无恢复扫描）。
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    // 入队前：画布插入「待开始」音频占位节点（源视频节点左侧）；失败不阻塞建任务（提取仍继续）。
    await placeMediaExtractPendingNode(this.prisma.client, {
      projectId,
      jobId: job.id.toString(),
      sourceAssetId,
    }).catch(() => {});
    return ok({
      job_id: job.id.toString(),
      status: "queued",
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免媒体提取任务无恢复扫描而静默悬挂。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户。 */
  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.client.generation_jobs.updateMany({
      where: { id: BigInt(jobId), status: "queued" },
      data: {
        status: "failed",
        error: {
          code,
          message,
          ...(details !== undefined ? { details } : {}),
        } as never,
        next_action_at: null,
        version: { increment: 1 },
      },
    });
  }
}
