// IKHW59：音频调速（画布音频卡「调速」，父单 IKHVYO）建任务服务。校验音频资产归属 →
// 插 generation_jobs(type=audio_speed)。一对一复刻 audio-trims.service（IKHB6N 先例）。
// 契约单源 = @lib/contracts/audio-speed（IKHW48）：input 键名 / speed 域与精度 / 贴原速省略
// 全部 import 契约常量，本文件不另写键名；冻结前经 audioSpeedInputSchema 服务端复核
// （speed ∈ [0.1,4.0]、最多两位小数——契约层精度收口，超精度在创建入口即拒）。
// 免费口径（同 audio_trim / media_extract）：不写成本预留、不接成本估算、不走余额拦截门。
import { Injectable } from "@nestjs/common";
import {
  AUDIO_SPEED_INPUT_KEYS,
  AUDIO_SPEED_JOB_TYPE,
  AUDIO_SPEED_SOURCE,
  FAILURE_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  audioSpeedInputSchema,
  fail,
  ok,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class AudioSpeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: {
      source_asset_id?: unknown;
      speed?: unknown;
    },
    // 与 audio_trim 同构（audio-trims.service.ts 的 internal 形参）：请求方 sk- 凭证
    // 冻结进 job input.provider_credential，worker 切网关后直接取用；未携带/非 sk- 时不写键。
    internal: { providerCredential?: string } = {},
  ) {
    const sourceAssetId =
      typeof body.source_asset_id === "number" ||
      typeof body.source_asset_id === "string"
        ? String(body.source_asset_id)
        : "";
    if (!sourceAssetId) {
      return fail(PARAM_MISSING_CODE, "缺少 source_asset_id");
    }

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    // 归属口径对齐 audio_trim / media_extract（契约 §18.5）——findOwnedSource 按 user_id 归属过滤
    // （status=normal 且未删除），非本人素材一律 404 不泄露存在性。
    const asset = await this.assets.findOwnedSource(sourceAssetId, userId);
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "audio") {
      return fail(FAILURE_CODE, "仅支持调速音频资产");
    }

    // 冻结结构复核（契约注释口径：创建入口复核用 audioSpeedInputSchema）：speed 可选键
    // （贴原速省略口径——缺省不补键，undefined = 走官方默认 1；显式传值必须为 [0.1, 4.0]
    // 内最多两位小数的 number，越界 / 超精度 / 非数字一律拒）。构造时用条件展开保证省略
    // 场景原样落库（键不写，同截取贴边省略口径）。
    const input = {
      [AUDIO_SPEED_INPUT_KEYS.sourceAssetId]: sourceAssetId,
      ...(body.speed !== undefined ? { [AUDIO_SPEED_INPUT_KEYS.speed]: body.speed } : {}),
    };
    const parsed = audioSpeedInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, parsed.error.issues[0]?.message ?? "音频调速参数非法");
    }

    const job = await this.prisma.client.generation_jobs.create({
      data: {
        user_id: BigInt(userId),
        project_id: BigInt(projectId),
        type: AUDIO_SPEED_JOB_TYPE,
        source: AUDIO_SPEED_SOURCE,
        status: "queued",
        progress: 0,
        input: {
          ...parsed.data,
          // provider_credential 是业务键之上的基础设施键（不进契约 zod——audio_trim 同构）：
          // 请求方 sk- 明文冻结，worker 切网关后直接取用；未携带/非 sk- 时不写键。
          ...(internal.providerCredential
            ? { provider_credential: internal.providerCredential }
            : {}),
        },
        // 过去 60s：audio_speed 即时消费无延迟，next_action_at 必须 ≤ now 才能被 claim。
        // DATETIME(0) 秒精度会把 new Date() 进位到下一秒 → 同秒 claim 的 lte now 判 false，
        // 任务悬挂（audio_trim / media_extract 同款教训）。
        next_action_at: new Date(Date.now() - 60_000),
      },
    });
    return ok({
      job_id: job.id.toString(),
      status: "queued",
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免调速任务无恢复扫描而静默悬挂。
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
