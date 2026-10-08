/* ============================================
 * 价格预览（Quote）—— 生成前告诉用户「这次预计消耗多少积分」
 *
 * ⚠️ **只读**：不冻结、不写库、不改任何状态、不碰余额。所以它与预扣（Hold）的失败语义
 *    **相反**：Hold fail closed（扣不动就别开始干活），报价 fail open —— 算不出价
 *    （定价漏配 UNPRICEABLE / billing 不可用）就回 `credits: null`，前端不显示价格。
 *    **报价的失败绝不阻断任何操作**：这条路径一分钱都不动。
 *
 * ⚠️ **与预扣同源**：规格走建任务那一个 {@link projectQuoteInput}（内部就是 strategies
 *    的 composeInput），等级走同一个 `identity.resolveTier` —— 预览价必须等于实际会冻的钱。
 *    这两处任何一处分叉，用户就会看到「预览一个价、实扣另一个价」。
 * ============================================ */
import { createHash } from "node:crypto";

import { RESOURCE_NOT_FOUND_CODE, fail, frozenVideoModeOf, ok, type ResultEnvelope } from "@lib/contracts";
import {
  DEFAULT_IMAGE_REFERENCE_MAX,
  type AssetOwnershipOps,
  type CanvasRepo,
  type ModelCapabilityRepo,
  type ProjectRepo,
} from "@lib/shared/persistence/index.js";

import type { BillingQuote } from "../billing/billing-quote.js";
import {
  resolveReferenceDurations,
  videoAssetIdsNeedingDuration,
} from "./resolve-reference-durations.js";
import {
  applyEditSourceDurationBasis,
  canonicalJson,
  projectQuoteInput,
  resolveTextIndexReferences,
  ruleSampleMode,
  type CreateGenerationJobBody,
  type GenerationType,
  serializePricingRule,
} from "./handle-create-generation-job.js";

export interface QuoteGenerationJobDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  /** 能力目录白名单：报价要按**同一份**能力行冻结规格（如 features.audio ⇒ generate_audio）。 */
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  /** IKJGE6：视频草稿目标的画布读取——文本带入参考做与建任务同一套服务端合并
   *  （画布文本提及的视频参考只在建任务侧合并，是预览价 ≠ 实扣价的分叉源）。 */
  canvas: Pick<CanvasRepo, "getByProject">;
  /** IKJGE6：合并后视频参考的时长权威回填（与建任务同一 resolveInputAssets——预览与
   *  实扣的时长必须出自同一个数，不能用前端自带值）。 */
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
  /** 报价函数（`billing-quote.ts` 装配：同一套规格归一 + 同一个 resolveTier；
   *  结果附报价侧实际生效的 tier —— quote_revision 要用同一份等级）。 */
  quote: BillingQuote;
}

/** 价格预览的响应体 —— 契约 StageQuoteView（video-sample-mode.ts §2）并入报价入口响应：
 *  - `credits`：**只有一个整数积分**，或 null（无报价）。
 *  - `quote_revision`：报价版本指纹；供后续提交核对（提交原样带回，服务端复算不一致即
 *    `quote_stale` —— 提交确认是后续子票，这里只负责报价侧给出）。
 *
 *  ⚠️ 硬规则：任何用户可见界面**永远只出现一个金额**。折扣系数（discount_bp）、
 *    预扣明细这些一概不回 —— 用户看到的必须是最终的、他会被扣的那个数。
 *  ⚠️ 无报价时两字段**同时**为 null（契约 superRefine：不存在「有版本无价格」）。 */
export interface QuoteGenerationJobData {
  credits: number | null;
  quote_revision: string | null;
  /** IKJ797：`"source_video"` = 本次预估按**源参考视频最长时长**计（编辑单——官方 edit 语义
   *  输出时长跟随参考视频，用户所选时长不参与计价）。前端据此在预估徽标旁标注「按源视频时长预估」。
   *  字段不出现 = 按用户所选时长预估（延长单/参考单/量不到源时长的编辑单）。 */
  duration_basis?: "source_video";
}

/** 空报价（双 null）：算不出价 / 门控未放行时不给出任何可提交金额。 */
const EMPTY_QUOTE: QuoteGenerationJobData = { credits: null, quote_revision: null };

/** quote_revision（契约 §2）：报价版本指纹 = 目录版本 + 能力行版本 + 用户等级 + 冻结输入指纹。
 *
 *  四要素任一变化 → revision 变化：目录调价、能力行改配（乐观锁 version 跳变）、用户升级、
 *  规格改动（如时长）都会让旧 revision 失效。**后续提交子票**按同一函数复算，不一致即拒
 *  （`quote_stale`，1056）——「报价不可用或报价变动时不能按未知或未确认的金额提交」。
 *  导出供提交侧复用；不放进 contracts（那是跨进程契约，这是本进程两侧共用的实现）。 */
export function quoteRevisionOf(args: {
  catalogVersion: number;
  /** 能力行乐观锁版本（ModelCapabilityView.version）。 */
  capabilityVersion: number | undefined;
  tier: string;
  /** 报价规格投影（projectQuoteInput 的产出 —— 与建任务同源的那份）。 */
  quoteInput: Record<string, unknown>;
}): string {
  const inputFingerprint = createHash("sha256")
    .update(canonicalJson(args.quoteInput))
    .digest("hex")
    .slice(0, 12);
  const cap = args.capabilityVersion === undefined ? "none" : String(args.capabilityVersion);
  return `catalog-${args.catalogVersion}:cap-${cap}:tier-${args.tier}:input-${inputFingerprint}`;
}

/**
 * POST /api/projects/:projectId/generation-jobs/quote
 *
 * 入参与创建任务**同形**（同一个 parameters ⇒ 同一个 model / 同一份规格），否则预览与实扣会漂。
 *
 * 只有「项目不存在」是错误：模型不在白名单里、类型不支持、参数不全、报价算不出、样片门控
 * 未放行，一律回空报价（`{ credits: null, quote_revision: null }`）。理由 —— 那些情况创建时
 * 自会给出准确的拒绝文案，而预览不该抢在前面把一次「看看多少钱」的请求变成报错。
 */
export async function handleQuoteGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  deps: QuoteGenerationJobDeps,
): Promise<ResultEnvelope<QuoteGenerationJobData | null>> {
  // 项目归属（不泄漏存在性）——与建任务同一道，预览也不能跨项目看价。
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const type = body.type as GenerationType;
  const params = body.parameters as
    | { model_id?: unknown; sample_mode?: unknown; resolution?: unknown }
    | undefined;
  const modelId = typeof params?.model_id === "string" ? params.model_id : null;
  if (modelId === null) return ok(EMPTY_QUOTE);

  const whitelist = await deps.models.listEnabledByType(type);
  // 不在能力目录（未启用/已停用）的模型**不给报价**：那个组合本来就提交不了，
  // 报个价只会让用户以为能生成、点下去才知道 400。这里不报错（预览不该抢在建任务前面拒绝）。
  const capability = whitelist.find((m) => m.model_id === modelId);
  if (!capability) return ok(EMPTY_QUOTE);

  // IKIZQ7：样片增量门控（fail open）——与创建入口共用 ruleSampleMode 一条判定。
  // 能力行未声明 features.sample_mode（默认关闭，其他模型一律不可用）、非 video、非 480p、
  // 非字面 true 或非单输出 → 空报价（那个请求创建时会被 400，报价不给出可提交金额）；
  // 未传或 false 零影响（普通视频报价语义）。
  const ruling = ruleSampleMode({
    type,
    sampleMode: params?.sample_mode,
    resolution: params?.resolution,
    expectedOutputCount: Number(body.expected_output_count),
    capability,
  });
  if (ruling.kind === "rejected") return ok(EMPTY_QUOTE);

  // IKJGE6：报价判定输入与建任务同源——视频草稿目标（target_node_id）的画布文本带入参考
  // 在服务端做与建任务同一套合并 + 时长权威回填。此前报价按原始请求体投影，画布文本带入的
  // 视频参考进不了判定输入：编辑单被误判 default，按用户所选时长出价，而实扣按合并后的
  // 源视频时长冻结——「预览价 = 实扣价」在该场景断开。合并校验失败（失效索引/帧互斥/超限
  // ——建任务侧会 400）回空报价：不给一个提交不了的价格。仅视频需要；图片/音频面板报价
  // 不带 target_node_id，行为不变。
  let effectiveBody: CreateGenerationJobBody = body;
  const targetNodeId =
    typeof body.target_node_id === "string" && body.target_node_id.trim() !== ""
      ? body.target_node_id
      : null;
  if (type === "video" && targetNodeId !== null) {
    const textIndexRefs = await resolveTextIndexReferences({
      type,
      body,
      projectId,
      deps: { canvas: deps.canvas },
      // 视频分支 merged 恒等于 directReferenceAssetIds 原样返回，报价只消费 videoReferences、
      // 不读 merged——传空数组无害，建任务侧才需要传真实直接参考 ids 供 merged 回填。
      directReferenceAssetIds: [],
      imageReferenceMax:
        capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX,
      ...(capability ? { capability } : {}),
    });
    if (!textIndexRefs.ok) return ok(EMPTY_QUOTE);
    if (textIndexRefs.value.videoReferences) {
      // IKJIVA：时长回填管线与建任务单份同源（resolve-reference-durations）；本侧差异只有：
      // 筛选面=缺时长视频（最小查询谓词）、shortfall 不回填——用合并后原样 references 出价
      // （合并不丢），编辑口径按「量不到源时长」回落用户所选（applyEditSourceDurationBasis 立场）。
      const merged = textIndexRefs.value.videoReferences;
      const ruling = await resolveReferenceDurations({
        references: merged,
        assetIdsOf: videoAssetIdsNeedingDuration,
        userId,
        projectId,
        assets: deps.assets,
      });
      effectiveBody = {
        ...body,
        references: ruling.kind === "resolved" ? ruling.references : merged,
      };
    }
  }

  const input = projectQuoteInput(type, effectiveBody, capability);
  if (input === null) return ok(EMPTY_QUOTE);

  // IKJ797：编辑单按源参考视频最长时长预估（现场判定——报价发生在创建前，无快照可读，
  // 与预扣/快照冻结是同一个纯函数同一份输入）。提示词从请求体取：报价 payload 是创建任务的
  // 同形定价部分，挂参考视频的 2.5 场景会带上（判定输入与创建时同一份）；未带则判不出 edit，
  // 按用户所选预估（= 现行为），前端补带提示词属前端票范围。IKJGE6 起 input 的参考集合已含
  // 文本带入合并项（上方 effectiveBody），编辑判定与建任务冻结真正同源。
  const quoteParams = effectiveBody.parameters as { prompt?: unknown } | undefined;
  const prompt = typeof quoteParams?.prompt === "string" ? quoteParams.prompt : "";
  const bySourceVideo = applyEditSourceDurationBasis(
    input,
    frozenVideoModeOf(input),
    capability?.features?.task_types,
  );

  // 规则快照与 Hold 同源：预览与实扣必须取到**同一份**规则，
  // 否则用户看到的是「预览一个价、实扣另一个价」。序列化在 `handle-create-generation-job`
  // 的同名助手处，两边共用一条实现（那一个函数导出于此）。
  const ruleSnapshot = serializePricingRule(capability);
  const quote = await deps.quote({
    userId,
    modelId,
    taskType: type,
    input,
    ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
  });
  if (quote === null) return ok(EMPTY_QUOTE);
  return ok({
    credits: Number(quote.credits),
    quote_revision: quoteRevisionOf({
      catalogVersion: quote.catalogVersion,
      capabilityVersion: capability.version,
      tier: quote.tier,
      quoteInput: input,
    }),
    ...(bySourceVideo ? { duration_basis: "source_video" as const } : {}),
  });
}
