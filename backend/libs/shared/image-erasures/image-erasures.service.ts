// IKGOT4：图片擦除建任务服务（仿 image-enhancements 的免费轻量入口，契约 §15）。
// 校验源/遮罩图片资产归属与场景合法性 → 复核输入门槛（尺寸/大小/格式，宽高 null 放行）
// → 插 generation_jobs(type=image_erase)。
// 免费口径（同 image-enhancements / media-extractions）：不写成本预留、不接成本估算、不走余额拦截门。
// 不写画布——擦除结果卡由前端发送任务时本地插入，产物经 GET /api/jobs/:id 的 asset 按 target_node_id 回填。
// IKJJQW（B.3）：创建入口接入恢复协议 v1——canvas_binding 随 body 提交（剥离后不进业务 zod），
// Idempotency-Key 头承载 submission_id；受理走共享受理段（media-tool-recovery），无 canvas_binding
// 的历史请求保持原路径（不写幂等行、不写恢复关联）。
import { Injectable } from "@nestjs/common";
import {
  FAILURE_CODE,
  IDEMPOTENCY_CONFLICT_CODE,
  IMAGE_ERASE_INPUT_FORMATS,
  IMAGE_ERASE_INPUT_KEYS,
  IMAGE_ERASE_JOB_TYPE,
  IMAGE_ERASE_MAX_FILE_BYTES,
  IMAGE_ERASE_MAX_SHORT_SIDE_PX,
  IMAGE_ERASE_MAX_LONG_SIDE_PX,
  IMAGE_ERASE_MIN_SIDE_PX,
  IMAGE_ERASE_SOURCE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  imageEraseInputSchema,
  ok,
  type ImageEraseInput,
} from "@lib/contracts";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import {
  createMediaToolJobWithRecovery,
  mediaToolRequestHash,
  readAcceptedMediaToolReplay,
  renderMediaToolReplay,
  stripCanvasBinding,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** 幂等域（先例命名「领域.动作」：video_matting.create 同款）。 */
const IDEMPOTENCY_OPERATION = "image_erase.create";
const REQUEST_PATH = "/image-erasures";

/** zod 校验失败 → 人能读懂的原因（按首个出错键名映射；前端置灰只是体验层，这里返回可读文案）。 */
const PARSE_ERROR_MESSAGES: Record<string, string> = {
  [IMAGE_ERASE_INPUT_KEYS.sourceAssetId]: "缺少或非法的源素材 ID（source_asset_id）",
  [IMAGE_ERASE_INPUT_KEYS.targetNodeId]: "缺少目标节点 ID（target_node_id）",
  [IMAGE_ERASE_INPUT_KEYS.eraseScene]: "擦除场景仅支持 full_screen_text_erase / selected_area_erase",
  [IMAGE_ERASE_INPUT_KEYS.maskAssetId]: "遮罩场景缺少或非法的遮罩素材 ID（mask_asset_id）",
};

function readableParseError(issues: readonly { code: string; path: readonly (string | number | symbol)[]; keys?: readonly string[] }[]): string {
  const first = issues[0];
  if (first?.code === "unrecognized_keys") {
    // full_screen_text_erase 分支无 mask_asset_id 键（契约 strict）：清除文字场景传遮罩在此拦截。
    if (first.keys?.includes(IMAGE_ERASE_INPUT_KEYS.maskAssetId)) {
      return "清除文字场景不支持传遮罩素材（mask_asset_id），请改用涂抹场景";
    }
    return "请求包含不支持的参数，仅允许擦除任务的 source_asset_id / target_node_id / erase_scene / mask_asset_id 键";
  }
  const key = typeof first?.path[0] === "string" ? (first.path[0] as string) : "";
  return PARSE_ERROR_MESSAGES[key] ?? "请求参数不合法";
}

/** 从素材 mime（优先，DB 记录上传时的权威值）或 URL / 存储键扩展名取格式 token（小写）。
 *  上传与生成资产的存储键都带真实扩展名（tos-storage.ts presign / worker TosMediaStorage），
 *  两处都取不到 → null。webp/gif 等 token 不在白名单内由调用方拒。 */
function detectAssetFormat(asset: {
  mime: string | null;
  url: string;
  storage_key: string | null;
}): string | null {
  const mime = asset.mime?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mime.startsWith("image/")) {
    const subtype = mime.slice("image/".length);
    if (subtype) return subtype;
  }
  for (const locator of [asset.url, asset.storage_key]) {
    if (!locator) continue;
    const path = locator.split("?", 1)[0] ?? locator;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    if (path.includes(".") && /^[a-z0-9]{2,8}$/.test(ext)) return ext;
  }
  return null;
}

@Injectable()
export class ImageErasuresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
    private readonly assets: AssetService,
  ) {}

  async create(
    userId: string,
    projectId: string,
    body: Record<string, unknown>,
    // 与图片生成同构（handle-create-generation-job.ts 的 internal 形参）：请求方 sk- 凭证冻结进 job。
    internal: { providerCredential?: string } = {},
    // IKJJQW（B.3）：新协议承载——Idempotency-Key 头必须等于 canvas_binding.submission_id。
    idempotencyKey?: string,
  ) {
    // IKJJQW：canvas_binding 是业务键之上的基础设施键（同 client_token 口径）：先行剥离再过
    // 契约 schema；携带但非法 / 与 Idempotency-Key 承载不一致 → 400 invalid_recovery_payload
    // （IKJLTZ：三段校验收敛至 stripCanvasBinding，头承载的 trim 口径留在调用方）。
    const gate = stripCanvasBinding(body ?? {}, "Idempotency-Key", (idempotencyKey ?? "").trim());
    if (gate.error) return gate.error;
    const { binding, rest } = gate;

    // 契约 schema 复核（按场景 strict）：场景枚举、mask_asset_id 必填/禁填分支在此拦截。
    const parsed = imageEraseInputSchema.safeParse(rest);
    if (!parsed.success) {
      return fail(PARAM_MISSING_CODE, readableParseError(parsed.error.issues));
    }
    const input: ImageEraseInput = parsed.data;

    const project = await this.project.findOwnedById(projectId, userId);
    if (!project) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

    // IKJLTX（R5，B.3 受理事务顺序）：同身份同载荷的原意图幂等回读先于素材/门槛等可变状态
    // 校验——已受理重放返回原 job 与原关联，不因此刻素材已删除/门槛不过而重新拒绝或重复受理。
    // 摘要只依赖请求载荷与 canvas_binding（mediaToolRequestHash），与可变状态无关。
    const recovery: MediaToolRecovery | null = binding
      ? {
          projectId,
          userId,
          taskType: IMAGE_ERASE_JOB_TYPE,
          operation: IDEMPOTENCY_OPERATION,
          requestHash: mediaToolRequestHash(IDEMPOTENCY_OPERATION, projectId, REQUEST_PATH, body ?? {}),
          binding,
        }
      : null;
    const replay = recovery
      ? await readAcceptedMediaToolReplay(this.prisma.client, recovery)
      : null;
    if (replay) return renderMediaToolReplay(replay);

    // findOwnedSource 按 user_id 归属过滤（status=normal 且未删除）：非本人素材一律 404，不泄露存在性。
    const asset = await this.assets.findOwnedSource(
      input[IMAGE_ERASE_INPUT_KEYS.sourceAssetId],
      userId,
    );
    if (!asset) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    if (asset.type !== "image") {
      return fail(FAILURE_CODE, "仅支持对图片资产发起擦除");
    }

    // 遮罩场景校验：mask_asset_id 必须存在且归属当前用户（与源素材同一套归属校验），且必须是图片。
    // （按判别键直接访问收窄联合类型；键名与取值仍以契约 schema 为准。）
    if (input.erase_scene === "selected_area_erase") {
      const mask = await this.assets.findOwnedSource(
        input[IMAGE_ERASE_INPUT_KEYS.maskAssetId],
        userId,
      );
      if (!mask) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
      if (mask.type !== "image") {
        return fail(FAILURE_CODE, "遮罩素材必须是图片资产");
      }
    }

    // 输入门槛复核（官方输入分辨率限制，短边/长边语义：10 ≤ 短边 ≤ 1440、10 ≤ 长边 ≤ 2560，
    // 竖图 1440x2560 合法；常量单源在契约 image-erase.ts，web 菜单预检同源）。
    // assets.width/height 由前端上报、存量图大量为 null：缺权威尺寸不臆造、不拦——放行交供应商
    // 按官方门槛拒（与高清放大同口径）。
    if (asset.width != null && asset.height != null) {
      const longSide = Math.max(asset.width, asset.height);
      const shortSide = Math.min(asset.width, asset.height);
      if (
        longSide > IMAGE_ERASE_MAX_LONG_SIDE_PX ||
        shortSide > IMAGE_ERASE_MAX_SHORT_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `图片长边超过 ${IMAGE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${IMAGE_ERASE_MAX_SHORT_SIDE_PX} 像素上限，无法擦除`,
        );
      }
      if (
        asset.width < IMAGE_ERASE_MIN_SIDE_PX ||
        asset.height < IMAGE_ERASE_MIN_SIDE_PX
      ) {
        return fail(
          FAILURE_CODE,
          `图片尺寸小于 ${IMAGE_ERASE_MIN_SIDE_PX}x${IMAGE_ERASE_MIN_SIDE_PX} 像素，无法擦除`,
        );
      }
    }
    if (asset.size != null && asset.size > IMAGE_ERASE_MAX_FILE_BYTES) {
      return fail(FAILURE_CODE, "图片大小超过 10MB 上限，无法擦除");
    }
    const format = detectAssetFormat(asset);
    if (!format || !(IMAGE_ERASE_INPUT_FORMATS as readonly string[]).includes(format)) {
      return fail(FAILURE_CODE, "仅支持 png / jpg / jpeg / heic 格式的图片发起擦除");
    }

    // 契约 schema parse 后原样冻结（重试原样沿用，§15）。
    // provider_credential 是业务键之上的基础设施键（不进契约 zod——它校验的是客户端 payload，
    // 凭证由服务端注入）：与图片生成 / 高清放大同构，请求方 sk- 明文冻结进 job input，
    // worker（ImageEraseJobProcessor）处理时直接取用；未携带/非 sk- 时不写键。
    const frozenInput: ImageEraseInput & { provider_credential?: string } = {
      ...input,
      ...(internal.providerCredential
        ? { provider_credential: internal.providerCredential }
        : {}),
    };

    // IKJJQW：受理主体走共享段（B.3）——有 canvas_binding 时「恢复锁序核对 → 建行 → 关联行 →
    // 幂等行」一个事务；无 canvas_binding 时建行路径与接入前一致。业务校验在事务外（锁不跨
    // 素材查询），重放先于业务校验（同身份同载荷不重做当前状态校验——IKJLTX 前置回读在上，
    // 锁外快路径与锁内兜底在 helper 内）。
    const outcome = await createMediaToolJobWithRecovery(
      this.prisma.client,
      recovery,
      async (db) => {
        const job = await db.generation_jobs.create({
          data: {
            user_id: BigInt(userId),
            project_id: BigInt(projectId),
            type: IMAGE_ERASE_JOB_TYPE,
            source: IMAGE_ERASE_SOURCE,
            status: "queued",
            progress: 0,
            input: frozenInput,
            // 过去 60s：回拨口径同 media_extract——DATETIME(0) 秒精度进位会让同秒 claim 的 lte now 判 false。
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        return { jobId: job.id.toString(), status: "queued" };
      },
    );
    if (outcome.kind === "envelope") return outcome.envelope;
    if (outcome.kind === "idempotency_conflict") {
      return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
    }
    return ok({
      job_id: outcome.jobId,
      status: outcome.status,
      ...(outcome.bindingView ? { canvas_binding: outcome.bindingView } : {}),
    });
  }

  /** 入队失败兜底：queued 任务直接置 failed，避免擦除任务在 worker 恢复扫描接管前静默悬挂。
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
