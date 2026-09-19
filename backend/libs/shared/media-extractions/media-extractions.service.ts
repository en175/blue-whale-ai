// IKARDY：媒体提取（视频→音频）建任务服务。校验视频资产归属 → 插 generation_jobs(type=media_extract)。
// IKFS5W：不写画布——占位节点由前端建任务前本地插入，产物经 GET /api/jobs/:id 的 asset 回给前端落库。
// IKH28T：output_format 枚举/默认值/拒绝口径单源到契约 @lib/contracts/media-extract（m4a 默认、
// 非法值明确拒绝，静默回退口径随契约废除）；其余创建入口行为切换（凭证冻结等）由 IKH28V 承载。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_INPUT_KEYS,
  MEDIA_EXTRACT_JOB_TYPE,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  MEDIA_EXTRACT_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
  type MediaExtractOutputFormat,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

const SUPPORTED_FORMATS: ReadonlySet<string> = new Set(MEDIA_EXTRACT_OUTPUT_FORMATS);

/** 契约枚举类型守卫（Set.has 不做类型窄化，收口在这单处）。 */
function isSupportedFormat(value: unknown): value is MediaExtractOutputFormat {
  return typeof value === "string" && SUPPORTED_FORMATS.has(value);
}

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
    // IKH28T 契约口径：缺省补默认 m4a（官方 PDF format 节描述文字），非法值明确拒绝
    // （不再静默回退 mp3——枚举五值 m4a/mp3/ogg/flac/wav 单源在 @lib/contracts/media-extract）。
    let outputFormat: MediaExtractOutputFormat = MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT;
    if (body.output_format !== undefined) {
      if (!isSupportedFormat(body.output_format)) {
        return fail(PARAM_MISSING_CODE, "output_format 仅支持 m4a / mp3 / ogg / flac / wav");
      }
      outputFormat = body.output_format;
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    const asset = await this.assets.findAccessible(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "video") {
      return fail(FAILURE_CODE, "仅支持从视频资产提取音频");
    }

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: MEDIA_EXTRACT_JOB_TYPE,
        source: MEDIA_EXTRACT_SOURCE,
        status: "queued",
        progress: 0,
        expected_output_count: 1,
        input: {
          [MEDIA_EXTRACT_INPUT_KEYS.sourceAssetId]: sourceAssetId,
          [MEDIA_EXTRACT_INPUT_KEYS.outputFormat]: outputFormat,
        },
        // 过去 60s：media_extract 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
        // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，任务悬挂（media_extract 无恢复扫描）。
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    return ok({
      job_id: job.id.toString(),
      status: "queued",
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免媒体提取任务无恢复扫描而静默悬挂。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户。逻辑在 repo.markFailedQueued（IKDZGH 收敛）。 */
  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await createGenerationCommandRepo(this.prisma.client).markFailedQueued(
      jobId,
      code,
      message,
      details,
    );
  }
}
