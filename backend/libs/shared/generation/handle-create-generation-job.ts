import { freezePromptPlans } from "./prompt-plan-snapshot.js";
import { checkReferenceLimits } from "../generation-runtime/reference-limits.js";
import { freezeReferenceLimits } from "../generation-runtime/video-reference-validation.js";
import type { CanvasEdge } from "@lib/contracts";
import {
  type PromptTargetNode,
} from "../canvas/prompt-target.js";
import { createHash } from "node:crypto";

import {
  resolvePromptMaxLength,
  IDEMPOTENCY_CONFLICT_CODE,
  ERROR_INVALID_INPUT,
  ERROR_INVALID_REFERENCE,
  ERROR_INVALID_REFERENCE_TYPE,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_QUOTE_STALE,
  VIDEO_SAMPLE_RESOLUTION,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  checkGenerationParamLimit,
  toGenerationParamCheckInput,
  resolveVideoTaskType,
  taskTypeAllowedRatios,
  ERROR_TASK_TYPE_PARAM_CONSTRAINT,
  TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
  hasTaskTypeConstraint,
  resolveOutputPixels,
  type VideoTaskType,
  videoRefLabel,
  buildReferenceMarkerLabels,
  mediaMentionSchema,
  fail,
  ok,
  type VideoRefItem,
  type TargetTextIndex,
  type TextAttachmentMedia,
  type TextAttachmentSnapshot,
  type TextIndexCanvasNode,
  previewSourceSchema,
  AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  TEXT_INDEX_INVALID_MESSAGE,
  TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
  VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE,
  textIndexOverflowMessage,
  checkAudioTextIndexSyncInput,
  checkTextIndexSyncInput,
  checkVideoTextIndexSyncInput,
  mergeTextProvidedReferences,
  textProvidedAudioReferences,
  textProvidedVideoReferences,
  textIndexOfTarget,
  textInputSignatureOf,
  type MediaMentionType,
  type TextProvidedVideoReference,
} from "@lib/contracts";
import {
  extractTextNodeText,
  transferReferenceMarkers,
} from "@lib/core";
import {
  DEFAULT_IMAGE_REFERENCE_MAX,
  CREATE_GENERATION_JOB_OPERATION,
  type CanvasRepo,
  type CreateJobIdempotency,
  type CreateJobInput,
  type CreateJobResult,
  type GenerationCommandRepo,
  type JobBilling,
  type ModelCapabilityRepo,
  type ModelCapabilityView,
  type ModelFeatures,
  type ProjectRepo,
  type AssetOwnershipOps,
} from "@lib/shared/persistence/index.js";
import type { BillingHold } from "@lib/shared/billing/billing-hold.js";
import type { BillingRelease } from "@lib/shared/billing/billing-release.js";
import type { BillingQuote } from "@lib/shared/billing/billing-quote.js";
import { quoteRevisionOf } from "./handle-quote-generation-job.js";

import {
  channelOf,
  mapImageChannelRequest,
  parseStoredChannel,
  parseStoredImageRequestMapping,
} from "./image-channel-parser.js";

/** 能力行的 `pricing` 序列化成 Hold 要的 JSON 文本；未配返回 `undefined`。
 *
 *  <p>**为什么在这里序列化一次**：proto 的 `rule_snapshot` 是 `string`（一整条 JSON 文本），
 *  而不是结构化消息——规则的形状是**定价域的知识**（kind 有 const/table/unset 三种、
 *  table 的键是规格组合），把它摊成 proto 消息等于让契约去追一个还在演进的配置形态。
 *  传文本，billing 那边照样用 `CatalogCompiler` 编译校验，语义一点不少。
 *
 *  <p>⚠️ 未配（`null`）时返回 `undefined` 而不是空串：proto3 里空串与「没设」不可区分，
 *  传空串会让 billing 分不清「这次没有规则」与「规则是空的」，只能一并回落目录。
 *  两者行为恰好一样，但显式地不传更诚实。 */
export function serializePricingRule(capability: ModelCapabilityView | undefined): string | undefined {
  const pricing = capability?.pricing;
  if (pricing === undefined || pricing === null) return undefined;
  try {
    return JSON.stringify(pricing);
  } catch {
    // 循环引用等在库里的 JSON 不可能出现（Prisma 读出来的是普通对象），
    // 真出现也只当「没配」——回落目录，不让一次序列化失败挡住用户的提交。
    return undefined;
  }
}

export interface GenerationParameters {
  prompt?: unknown;
  aspect_ratio?: unknown;
  model_id?: unknown;
  size?: unknown;
  web_search?: unknown;
  sequential_image_generation?: unknown;
  resolution?: unknown;
  duration?: unknown;
  /** IKG0LP：视频是否带音频（用户选择，缺省 true）。能力位 features.audio 允许时才冻结进快照。 */
  generate_audio?: unknown;
  /** IKIZQ7：样片模式增量参数（契约 video-sample-mode.ts）。undefined/false = 普通视频语义；
   *  字面 true 时须为 video + 480p + 单输出且能力行已声明 features.sample_mode（默认关闭）。 */
  sample_mode?: unknown;
}

export interface CreateGenerationJobBody {
  type?: unknown;
  input_asset_ids?: unknown;
  first_frame_asset_id?: unknown;
  last_frame_asset_id?: unknown;
  reference_asset_ids?: unknown;
  /** 素材库引用（MaterialReference）：上游素材库素材 ID（Asset- 前缀），仅视频生成。 */
  first_frame_material_id?: unknown;
  last_frame_material_id?: unknown;
  /** 元素 { id: "Asset-xxx", type: "image" | "video" }；素材零落表，类型由调用方声明。 */
  reference_materials?: unknown;
  /** IKDJNZ：视频参考素材单数组契约（保序）。元素 { role, asset_id?, material_id?, type }；
   *  存在时优先于旧的 reference_asset_ids/reference_materials/首尾帧字段。 */
  references?: unknown;
  /** IKDLQF/IKDLQG/IKDMQT：生成目标画布节点 id（图片=image/视频=video/音频=audio 媒体节点），仅三类生成允许携带。 */
  target_node_id?: unknown;
  /** IKG6EK / ADR-0088：**已退役**。原为正文素材标签结构（PromptDoc v1，IKFA1M）。
   *  后端不再解析、校验、编译或冻结它——携带时不报错、直接不读、不影响结果。
   *  保留字段声明只为兼容尚未升级的前端；前端停止发送（IKGJT5）后可一并删除。 */
  prompt_doc?: unknown;
  parameters?: unknown;
  expected_output_count?: unknown;
  /** IKIZQ8：样片提交确认（契约 confirmedSubmitFieldsSchema 的增量，仅
   *  parameters.sample_mode=true 时必填）：报价入口返回的整数积分与版本指纹。
   *  未开样片的请求不读这两个字段——普通视频创建语义零变化。 */
  expected_credits?: unknown;
  quote_revision?: unknown;
}

/** IKDJNZ：单数组 references 元素（保序）。asset_id（本地）与 material_id（素材库）二选一。 */
export interface ReferenceItemInput {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  /** IKDJNZ：图片/视频参考 + 参考音频（role 仅 reference）。 */
  type: "image" | "video" | "audio";
  /** ADR-0086：来源素材时长（秒，可选）——总时长限制校验用。 */
  duration?: number;
}

/** 素材库引用（MaterialReference）：仅格式校验（Asset- 前缀），存在性/状态由上游强校验。 */
export interface MaterialReferenceInput {
  id: string;
  /** IKDJNZ：支持参考音频（type:"audio"），与单数组 references 对齐；走旧 reference_materials 字段的音频引用同样生效。 */
  type: "image" | "video" | "audio";
}

// 素材库 ID 实测存在小写 asset- 前缀（如 asset-20260820153209-6c9z8），大小写不敏感校验；
// 本地 Asset id 为纯数字（BigInt），前缀判定不冲突。
const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

function materialId(v: unknown): string | null {
  return typeof v === "string" && MATERIAL_ID_PATTERN.test(v) ? v : null;
}

/** 解析 reference_materials；未传返回 []，格式非法返回 null（整体拒绝）。 */
function materialRefs(v: unknown): MaterialReferenceInput[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const refs: MaterialReferenceInput[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) return null;
    const { id, type } = item as { id?: unknown; type?: unknown };
    if (materialId(id) === null) return null;
    if (type !== "image" && type !== "video" && type !== "audio") return null;
    refs.push({ id: id as string, type });
  }
  return refs;
}

function uniqueMaterialRefs(
  refs: MaterialReferenceInput[],
): MaterialReferenceInput[] {
  return refs.reduce<MaterialReferenceInput[]>((result, ref) => {
    if (!result.some((r) => r.id === ref.id)) result.push(ref);
    return result;
  }, []);
}

/** IKDJNZ：解析单数组 references。
 *  - 未传返回 "absent"（走旧字段路径）
 *  - 合法返回 { kind: "ok", items }
 *  - 非法（非数组 / 空数组 / 元素缺 id / 首尾帧 video）返回 { kind: "invalid" } */
function parseReferences(
  v: unknown,
): { kind: "absent" } | { kind: "ok"; items: ReferenceItemInput[] } | { kind: "invalid" } {
  if (v === undefined || v === null) return { kind: "absent" };
  if (!Array.isArray(v)) return { kind: "invalid" };
  const items: ReferenceItemInput[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) return { kind: "invalid" };
    const { role, asset_id, material_id, type } = item as Record<string, unknown>;
    if (role !== "first_frame" && role !== "last_frame" && role !== "reference")
      return { kind: "invalid" };
    if (type !== "image" && type !== "video" && type !== "audio")
      return { kind: "invalid" };
    // asset_id（本地，纯数字）与 material_id（素材库 asset-...）二选一。
    const aid = typeof asset_id === "string" ? assetId(asset_id) : null;
    const mid = typeof material_id === "string" ? materialId(material_id) : null;
    if (aid === null && mid === null) return { kind: "invalid" };
    if (aid !== null && mid !== null) return { kind: "invalid" };
    // 首尾帧必须是图片；参考音频只能作普通参考（不能当首尾帧）。
    if (role !== "reference" && type !== "image") return { kind: "invalid" };
    // ADR-0086：解析可选 duration（来源素材时长，秒）——总时长限制校验用。
    const { duration } = item as Record<string, unknown>;
    items.push({
      role,
      ...(aid !== null ? { asset_id: aid } : { material_id: mid as string }),
      type,
      ...(typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? { duration }
        : {}),
    });
  }
  return { kind: "ok", items };
}

/** IKDJNZ：校验 references 的 role 唯一性（首/尾帧各至多 1，不能同帧双来源）。 */
function validateReferenceRoles(items: ReferenceItemInput[]): string | null {
  let firstFrame = 0;
  let lastFrame = 0;
  for (const item of items) {
    if (item.role === "first_frame") firstFrame += 1;
    if (item.role === "last_frame") lastFrame += 1;
  }
  if (firstFrame > 1) return "首帧只能指定一个";
  if (lastFrame > 1) return "尾帧只能指定一个";
  if (lastFrame > firstFrame) return "尾帧必须与首帧一起使用";
  return null;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

/** 字段是否携带实际内容（非空数组 / 非空字符串 / 非 null 非 undefined）。用于旧参考字段判定，
 *  避免空数组（如 input_asset_ids: []）被误判为「携带旧字段」。 */
function hasContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") return v.length > 0;
  return v !== undefined && v !== null;
}

function assetId(v: unknown): string | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0)
    return String(v);
  if (typeof v === "string" && /^[1-9][0-9]*$/.test(v)) return v;
  return null;
}

function assetIds(v: unknown): string[] {
  return Array.isArray(v)
    ? v.map(assetId).filter((id): id is string => id !== null)
    : [];
}

function uniqueAssetIds(ids: string[]): string[] {
  return ids.filter((id, index) => ids.indexOf(id) === index);
}

/** 生成类型（job.type）。建任务与价格预览共用这一个 —— 报价的任务类型必须与创建一致。 */
export type GenerationType = "image" | "video" | "audio";

/** 全类型公共校验：type 已由策略分派保证合法；此处校验 target_node_id / prompt /
 *  aspect_ratio（audio 跳过）/ model_id / expected_output_count。
 *  错误码与文案对齐 Java CreateGenerationJobRequest 约束（IKBQEE / ADR-0078 同源）。 */
function validateCommon(
  body: CreateGenerationJobBody,
  type: GenerationType,
): { code: string; message: string } | null {
  // IKDLQF/IKDLQG/IKDMQT：target_node_id 仅图片/视频/音频生成允许携带；携带时必须是有效字符串。
  const hasTargetNode = body.target_node_id !== undefined;
  if (hasTargetNode) {
    if (!isStr(body.target_node_id) || body.target_node_id.trim() === "")
      return { code: ERROR_INVALID_INPUT, message: "target_node_id 无效" };
  }
  const params = body.parameters as GenerationParameters | undefined;
  // IKDLQF：携带 target_node_id 时 prompt 允许为空字符串（缺省按空串处理）；
  // 全部有效文本为空的拒绝在 handler 读取画布快照后按正文全文（promptText）判定。
  // ADR-0085（IKESD6）：长度上限不再在此硬编码——校验位点在能力行查出的地方按
  // features.max_prompt_length 判定（validateCommon 早于白名单查询，拿不到能力行）。
  if (
    !params ||
    (!isStr(params.prompt) && (params.prompt !== undefined || !hasTargetNode))
  ) {
    return { code: ERROR_INVALID_INPUT, message: "prompt 无效" };
  }
  const promptText = isStr(params.prompt) ? params.prompt : "";
  if (!hasTargetNode && promptText.trim() === "") {
    return { code: ERROR_INVALID_INPUT, message: "prompt 无效" };
  }
  if (type !== "audio") {
    // ADR-0086：aspect_ratio 支持任务类型强制的 adaptive（首帧/首尾帧/编辑/延长）；非 adaptive 仍须数字:数字。
    if (
      !isStr(params.aspect_ratio) ||
      (params.aspect_ratio !== "adaptive" &&
        !/^[1-9][0-9]*:[1-9][0-9]*$/.test(params.aspect_ratio))
    ) {
      return { code: ERROR_INVALID_INPUT, message: "aspect_ratio 无效" };
    }
  }
  if (!isStr(params.model_id) || params.model_id.trim() === "")
    return { code: ERROR_INVALID_INPUT, message: "model_id 无效" };
  const count = Number(body.expected_output_count);
  if (!Number.isInteger(count) || count < 1 || count > 4)
    return {
      code: ERROR_INVALID_INPUT,
      message: "expected_output_count 须为 1-4",
    };
  if ((type === "video" || type === "audio") && count !== 1)
    return {
      code: ERROR_INVALID_INPUT,
      message: "视频/音频生成仅支持一个输出",
    };
  return null;
}

/** IKHBDO：参考素材分类上限判定已下沉到 `generation-runtime/reference-limits.ts`，
 *  由接纳侧与 SceneCard 再生成（scene-card-generation-repo）共用同一份实现，避免第三份副本漂移。
 *  此处转出保持既有导入面不变。 */
export { checkReferenceLimits };

/** IKE4GC：音频生成参考素材——仅接受单数组 references（audio|image，role 强制 reference）。
 *  音频/图片生成无首尾帧概念；分类上限由能力行（features.audio_reference_max / image_reference_max）驱动
 *  （ADR-0086），旧硬编码 ≤3/≤1 退役。不可混用（seed-audio 官方限制）。
 *  旧参考字段（reference_asset_ids/input_asset_ids/reference_materials/首尾帧字段）对音频仍不支持，
 *  且与 references 互斥。 */
function validateAudioReferences(
  body: CreateGenerationJobBody,
  features?: ModelFeatures,
): { code: string; message: string } | null {
  const parsed = parseReferences(body.references);
  if (parsed.kind === "invalid") {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
  }
  // 旧参考字段：仅当携带实际内容才视为「旧字段」——空数组/空串不误拒（前端可能发 input_asset_ids: []）。
  const hasLegacy =
    hasContent(body.reference_asset_ids) ||
    hasContent(body.input_asset_ids) ||
    hasContent(body.reference_materials) ||
    hasContent(body.first_frame_asset_id) ||
    hasContent(body.last_frame_asset_id) ||
    hasContent(body.first_frame_material_id) ||
    hasContent(body.last_frame_material_id);
  if (parsed.kind === "absent") {
    // 未走 references：音频仍不支持旧参考字段，不静默忽略。
    if (hasLegacy) {
      return {
        code: ERROR_UNSUPPORTED_INPUT,
        message: "音频生成暂不支持旧参考字段，请使用 references",
      };
    }
    return null;
  }
  if (hasLegacy) {
    return { code: ERROR_INVALID_REFERENCE, message: "references 不能与旧参考字段混用" };
  }
  if (parsed.items.length === 0) {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材不能为空" };
  }
  for (const item of parsed.items) {
    // 音频/图片生成无帧角色；video 参考对音频生成无意义。
    if (item.role !== "reference" || item.type === "video") {
      return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
    }
    // 音频生成不支持素材库（真人/虚拟人像库）引用：参考只能用本地资产（asset_id → 本地 url）。
    if (item.material_id !== undefined) {
      return {
        code: ERROR_UNSUPPORTED_INPUT,
        message: "音频生成不支持素材库引用",
      };
    }
  }
  const limitErr = features
    ? checkReferenceLimits(
        features,
        parsed.items
          .filter((r): r is ReferenceItemInput & { type: "audio" | "image" } => true)
          .map((r) => ({ type: r.type, duration: r.duration })),
        "audio",
      )
    : null;
  if (limitErr) return { code: ERROR_INVALID_REFERENCE, message: limitErr };
  return null;
}

/** 素材库引用（MaterialReference）仅视频生成可用；非 video 一律拒绝。
 *  IKG6EK / ADR-0088：单数组 `references` 里的 material_id 同样拒——图片端从旧字段
 *  `input_asset_ids` 切到 `references` 后，这道闸不能只管旧字段。 */
function validateRejectMaterialReferences(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  const singleRefs = parseReferences(body.references);
  if (
    body.first_frame_material_id !== undefined ||
    body.last_frame_material_id !== undefined ||
    body.reference_materials !== undefined ||
    (singleRefs.kind === "ok" && singleRefs.items.some((item) => item.material_id !== undefined))
  ) {
    return {
      code: ERROR_UNSUPPORTED_INPUT,
      message: "素材库引用仅支持视频生成",
    };
  }
  return null;
}

/** IKG6EK / ADR-0088：图片端认单数组 `references` 之后，形态非法不能再被静默忽略——
 *  以前图片只读旧字段，`references` 传什么都不影响结果；现在它决定参考清单，
 *  非法形态（非数组 / 元素缺 id / 首尾帧非图片…）必须明确拒绝，不静默当空处理。 */
function validateImageSingleRefs(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  return parseReferences(body.references).kind === "invalid"
    ? { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" }
    : null;
}

/** 视频特有校验：首尾帧 / 普通参考 asset 互斥 + 素材库引用（asset∨material 并集互斥/配对）。
 *  ADR-0086：普通参考按类型分类上限改读能力行（video_reference / video_reference_max /
 *  audio_reference / audio_reference_max / max_reference_duration_sec），旧「参考素材最多 12」退役。
 *  首帧/首尾帧的**比例**限制同样只认能力行（`features.task_types[...].allowed_ratios`）——
 *  2.5 锁 adaptive、2.0 不限，见下方那条闸的注释。 */
function validateVideo(
  body: CreateGenerationJobBody,
  capability?: ModelCapabilityView,
): { code: string; message: string } | null {
  const features = capability?.features;
  const inputAssetIds = Array.isArray(body.input_asset_ids)
    ? body.input_asset_ids
    : [];
  // IKA72G：image 参考图上限由 handler 读取模型能力配置（features.image_reference_max）后校验，
  // 不再在此写死 4。
  const firstFrameAssetId = assetId(body.first_frame_asset_id);
  const lastFrameAssetId = assetId(body.last_frame_asset_id);
  const hasExplicitFrames =
    body.first_frame_asset_id !== undefined ||
    body.last_frame_asset_id !== undefined;
  const hasExplicitInputs =
    hasExplicitFrames || body.reference_asset_ids !== undefined;
  if (body.first_frame_asset_id !== undefined && firstFrameAssetId === null)
    return { code: ERROR_INVALID_REFERENCE_TYPE, message: "首帧素材无效" };
  if (body.last_frame_asset_id !== undefined && lastFrameAssetId === null)
    return { code: ERROR_INVALID_REFERENCE_TYPE, message: "尾帧素材无效" };
  if (lastFrameAssetId !== null && firstFrameAssetId === null)
    return {
      code: ERROR_INVALID_REFERENCE,
      message: "尾帧必须与首帧一起使用",
    };
  if (
    body.reference_asset_ids !== undefined &&
    assetIds(body.reference_asset_ids).length !==
      (Array.isArray(body.reference_asset_ids)
        ? body.reference_asset_ids.length
        : -1)
  )
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材无效" };
  const explicitReferenceIds = uniqueAssetIds(
    assetIds(body.reference_asset_ids),
  );
  if (hasExplicitFrames && explicitReferenceIds.length > 0) {
    return {
      code: ERROR_INVALID_REFERENCE,
      message: "首尾帧模式不能与普通参考素材混用",
    };
  }
  // 素材库引用（MaterialReference）：仅视频生成可用；格式校验 + 与本地 Asset 引用按并集互斥/配对。
  // IKDJNZ：单数组 references 优先；存在时跳过旧字段校验路径。
  const parsed = parseReferences(body.references);
  if (parsed.kind === "invalid") {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
  }
  if (parsed.kind === "ok") {
    // Critical fix（review）：references 与旧字段并存 → 400，防止新旧混用静默丢引用。
    const hasLegacyRefFields =
      body.first_frame_asset_id !== undefined ||
      body.last_frame_asset_id !== undefined ||
      body.reference_asset_ids !== undefined ||
      body.first_frame_material_id !== undefined ||
      body.last_frame_material_id !== undefined ||
      body.reference_materials !== undefined;
    if (hasLegacyRefFields) {
      return { code: ERROR_INVALID_REFERENCE, message: "references 不能与旧参考字段混用" };
    }
    if (parsed.items.length === 0) {
      return { code: ERROR_INVALID_REFERENCE, message: "参考素材不能为空" };
    }
    const roleErr = validateReferenceRoles(parsed.items);
    if (roleErr) return { code: ERROR_INVALID_REFERENCE, message: roleErr };
    // ADR-0086 / IKHBDO：普通参考按类型分类上限**只认能力行**——视频素材需 video_reference 位、
    // 音频需 audio_reference 位、图/视频/音频各自数量上限与总时长（≤ max_reference_duration_sec）。
    // 本函数有两个调用形态：白名单解析**前**的策略预检（capability 缺省）与解析**后**的重跑
    // （handleCreateGenerationJob 内的 capability 复核 + effectiveBody 复核，两处都带 capability）。
    // 预检拿不到能力行，故此处**不判任何参考数量**：写死一个上限会先于配置生效，把把上限配到
    // 阈值以上的模型（如 image_reference_max: 30）永久卡死。数量是能力行的职责，由带 capability
    // 的重跑用 checkReferenceLimits 判定；预检只保留与模型无关的结构性校验。
    if (features) {
      const limitErr = checkReferenceLimits(
        features,
        parsed.items
          .filter((r) => r.role === "reference")
          .map((r) => ({ type: r.type, duration: r.duration })),
        "video",
      );
      if (limitErr) return { code: ERROR_INVALID_REFERENCE, message: limitErr };
    }
    // 首帧/首尾帧的比例闸：**按模型读能力行**，不写死。
    //
    // 官方《创建视频生成任务》的「不同模型的取值限制和 adaptive 适配规则」表：
    //   首帧或首尾帧生视频 · Seedance 2.5     = 默认且仅支持 adaptive
    //   首帧或首尾帧生视频 · Seedance 2.0 系列 = 支持 adaptive 或指定宽高比
    // 这里原先写死「有首帧就必须 adaptive（只要能力行含 adaptive）」，等于把 2.5 的规则套到
    // 2.0 上——把 2.0 明确允许的提交拒在门外。唯一事实源改回能力行
    // `features.task_types[first_frame|first_last_frame].allowed_ratios`：
    // 配了 `["adaptive"]`（2.5）才锁，未配（2.0）就不限。
    //
    // 判定复用 `resolveVideoTaskType` 而不是自己数 role：首尾帧分支排在关键词分支**之前**
    // 且只看 role，故传空提示词也能得到正确结果，不会与提交侧那一处判定分叉。
    if (features) {
      const hasFrame = parsed.items.some(
        (r) => r.role === "first_frame" || r.role === "last_frame",
      );
      const frameTaskType = hasFrame ? resolveVideoTaskType(parsed.items, "") : undefined;
      const allowedRatios = taskTypeAllowedRatios(features.task_types, frameTaskType);
      if (allowedRatios) {
        // 走到这里 aspect_ratio 一定是合法字符串：validateCommon 对非音频类型的
        // 缺失/非法比例已经 400 了（见上方 `aspect_ratio 无效`）。所以这里**不写**
        // 「未指定」兜底分支——那种分支不可达，写了只会让下一个人以为这里防住了什么。
        const ratio = (body.parameters as GenerationParameters | undefined)?.aspect_ratio as string;
        if (!allowedRatios.includes(ratio)) {
          return {
            code: ERROR_INVALID_INPUT,
            message: `当前任务类型（${frameTaskType}）不支持 比例 ${ratio}，可用：${allowedRatios.join(" / ")}`,
          };
        }
      }
    }
    return null;
  }
  const firstFrameAssetId2 = assetId(body.first_frame_asset_id);
  const lastFrameAssetId2 = assetId(body.last_frame_asset_id);
  const firstFrameMaterialId = materialId(body.first_frame_material_id);
  const lastFrameMaterialId = materialId(body.last_frame_material_id);
  if (
    body.first_frame_material_id !== undefined &&
    firstFrameMaterialId === null
  )
    return { code: ERROR_INVALID_REFERENCE_TYPE, message: "首帧素材库引用无效" };
  if (body.last_frame_material_id !== undefined && lastFrameMaterialId === null)
    return { code: ERROR_INVALID_REFERENCE_TYPE, message: "尾帧素材库引用无效" };
  if (firstFrameAssetId2 !== null && firstFrameMaterialId !== null)
    return { code: ERROR_INVALID_REFERENCE, message: "首帧只能指定一个来源" };
  if (lastFrameAssetId2 !== null && lastFrameMaterialId !== null)
    return { code: ERROR_INVALID_REFERENCE, message: "尾帧只能指定一个来源" };
  if (lastFrameMaterialId !== null && firstFrameMaterialId === null)
    return { code: ERROR_INVALID_REFERENCE, message: "尾帧必须与首帧一起使用" };
  const refs = materialRefs(body.reference_materials);
  if (refs === null)
    return { code: ERROR_INVALID_REFERENCE_TYPE, message: "参考素材库引用无效" };
  const uniqueRefs = uniqueMaterialRefs(refs);
  // 模式互斥按并集（asset ∨ material）：帧（首/尾帧任一类）与普通参考（asset refs ∨ material refs）
  // 不可并存；跨来源组合在创建即拒绝，不再拖到 Worker 执行时才失败。
  const hasFrameSource =
    firstFrameAssetId2 !== null ||
    lastFrameAssetId2 !== null ||
    firstFrameMaterialId !== null ||
    lastFrameMaterialId !== null;
  const hasRefSource =
    assetIds(body.reference_asset_ids).length > 0 || uniqueRefs.length > 0;
  if (hasFrameSource && hasRefSource) {
    return {
      code: ERROR_INVALID_INPUT,
      message: "首尾帧模式不能与普通参考素材混用",
    };
  }
  // IKHBDO：与上方单数组分支同一口径——参考数量只在有能力行时判（本调用形态的预检无 capability，
  // 由白名单解析后的重跑以 checkReferenceLimits 补齐）。
  const videoRefCount = uniqueRefs.filter((r) => r.type === "video").length;
  const audioRefCount = uniqueRefs.filter((r) => r.type === "audio").length;
  if (features) {
    const limitErr = checkReferenceLimits(
      features,
      uniqueRefs.map((r) => ({ type: r.type })),
      "video",
    );
    if (limitErr) return { code: ERROR_INVALID_REFERENCE, message: limitErr };
  }
  // ADR-0086：音频参考能力位（features.audio_reference 关 → 拒绝音频素材）；缺省能力行保留旧行为。
  if (features && !features.audio_reference && audioRefCount > 0) {
    return { code: ERROR_INVALID_REFERENCE, message: "当前模型不支持音频素材参考" };
  }
  if (features && !features.video_reference && videoRefCount > 0) {
    return { code: ERROR_INVALID_REFERENCE, message: "当前模型不支持视频素材参考" };
  }
  return null;
}

// ---- 策略：按生成类型分派 validate + composeInput。

/** IKIZQ7：样片增量参数的统一判定（报价与创建共用一条；契约 video-sample-mode.ts，金标 G01）。
 *
 *  - `absent`：未传或 false → 普通视频语义（现状不动，其他模型/旧请求零影响）；
 *  - `sample`：字面 true + video + 480p + 单输出 + 能力行已声明 `features.sample_mode`；
 *  - `rejected`：其余一律拒绝（不降级、不静默改写）——创建侧 400，报价侧空报价。
 *
 *  能力位缺省 false = **样片默认关闭**（toFeatures 归一）；放行 = 运营在能力行 features
 *  里声明 `sample_mode: true`，服务端同步执行门控（父规格 IKIZPZ「范围与门控」）。 */
export type SampleModeRuling =
  | { kind: "absent" }
  | { kind: "sample" }
  | { kind: "rejected"; code: string; message: string };

export function ruleSampleMode(args: {
  type: GenerationType;
  sampleMode: unknown;
  resolution: unknown;
  expectedOutputCount: number;
  /** exactOptionalPropertyTypes：创建侧的 capability 变量可能是 undefined（显式传入合法）。 */
  capability?: ModelCapabilityView | undefined;
}): SampleModeRuling {
  if (args.sampleMode === undefined || args.sampleMode === false) {
    return { kind: "absent" };
  }
  if (args.sampleMode !== true) {
    return { kind: "rejected", code: ERROR_INVALID_INPUT, message: "sample_mode 无效" };
  }
  if (args.type !== "video") {
    return { kind: "rejected", code: ERROR_UNSUPPORTED_INPUT, message: "样片模式仅支持视频生成" };
  }
  if (args.resolution !== VIDEO_SAMPLE_RESOLUTION) {
    return {
      kind: "rejected",
      code: ERROR_INVALID_INPUT,
      message: `样片模式分辨率必须为 ${VIDEO_SAMPLE_RESOLUTION}`,
    };
  }
  if (args.expectedOutputCount !== 1) {
    return { kind: "rejected", code: ERROR_INVALID_INPUT, message: "样片仅支持单个输出" };
  }
  if (args.capability?.features?.sample_mode !== true) {
    return {
      kind: "rejected",
      code: ERROR_CAPABILITY_UNSUPPORTED_PARAM,
      message: "当前模型未开放样片模式",
    };
  }
  return { kind: "sample" };
}

// 新增生成类型只需新增一个 strategy 并注册到 strategies，不再改动既有校验器（IKDZI1）。 ----

interface ComposeInputContext {
  body: CreateGenerationJobBody;
  params: GenerationParameters;
  resolvedModelId: string;
  promptText: string;
  targetNodeId: string | null;
  textAttachments: TextAttachmentSnapshot[];
  referenceAssetIds: Array<string | number>;
  /** IKG0LP：白名单解析后的能力行——视频用它判断 features.audio 是否允许带音频。 */
  capability?: ModelCapabilityView;
  /** IKJ795：视频任务类型（调用方单次判定的结果）——冻结进 input 快照（video_task_type），
   *  建任务与报价走同一 composeInput，两边的 specs 才不会漂（「预览价 = 实扣价」不变式）。 */
  videoTaskType?: VideoTaskType;
}

interface GenerationTypeStrategy {
  validate(
    body: CreateGenerationJobBody,
  ): { code: string; message: string } | null;
  composeInput(ctx: ComposeInputContext): Record<string, unknown>;
}

const imageStrategy: GenerationTypeStrategy = {
  validate(body) {
    return (
      validateCommon(body, "image") ??
      validateRejectMaterialReferences(body) ??
      validateImageSingleRefs(body)
    );
  },
  composeInput({
    params,
    resolvedModelId,
    promptText,
    targetNodeId,
    textAttachments,
    referenceAssetIds,
  }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
    if (isStr(params.size)) input.size = params.size;
    input.web_search = params.web_search === true;
    input.sequential_image_generation =
      params.sequential_image_generation === true;
    // IKA72G：image 参考图统一落 input_asset_ids（worker 读取同字段）。
    if (referenceAssetIds.length > 0) input.input_asset_ids = referenceAssetIds;
    if (targetNodeId !== null) {
      input.target_node_id = targetNodeId;
      input.text_attachments = textAttachments;
    }
    return input;
  },
};

const videoStrategy: GenerationTypeStrategy = {
  validate(body) {
    // ADR-0086：分类上限校验读能力行（白名单解析后以 capability.features 重跑，见 pipeline）。
    return validateCommon(body, "video") ?? validateVideo(body);
  },
  composeInput({
    body,
    params,
    resolvedModelId,
    promptText,
    targetNodeId,
    textAttachments,
    referenceAssetIds,
    capability,
    videoTaskType,
  }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;
    // IKJ795：任务类型判定结果冻结进输入快照——执行层（worker 出站传参与强制）与报价链路
    // 读这份字段，不再各自重算（两端不漂移）。存量快照无该字段由消费侧按 default 处理
    // （frozenVideoTaskTypeOf），不重算历史。视频恒有判定结果（resolveVideoTaskType 至少回 default）。
    if (videoTaskType !== undefined) input.video_task_type = videoTaskType;
    // IKG0LP：视频带音频——能力位允许时冻结用户选择（缺省 true，不支持则恒 false）；
    // 能力位不允许（false/未配）时不写该字段，worker 不下发，维持上游默认。
    // 契约：docs/specs/2026-09-15-ikg0lp-video-generate-audio-contract.md
    if (capability?.features?.audio === true) {
      input.generate_audio = params.generate_audio !== false;
    }
    // IKHBDO：参考素材上限（图/视频/音频数量 + 总时长）从能力行冻结进快照——
    // worker 不含任何模型知识，执行期只读这份配置（对齐上面 generate_audio 的冻结口径）。
    // 接纳侧仍按同一份 features 先判一次（checkReferenceLimits），冻结值只用于执行期复核。
    if (capability?.features) {
      input.reference_limits = freezeReferenceLimits(capability.features);
    }
    // 视频输出像素：按规格查能力行的像素表，冻成**两个标量**随快照走。
    //
    // 为什么是标量而不是整张表：billing 算 token 只需要这一次的宽高，而 `extractSpecs`
    // 只收标量（`billing-specs.ts`）——一张表进不了 specs。所以在这里解析完再冻。
    //
    // 为什么查不到就**不写**而不是写 0：billing 侧「specs 里有宽高就用、没有就回落目录」
    // 是过渡期的双向兼容（见 `TokenEstimator`）。写 0 会让回落失效、把一次「没配」变成
    // 一次「宽高是 0 的计算」——那是另一个意思，且会算出离谱的 token 数。
    if (capability?.features && isStr(params.resolution) && isStr(params.aspect_ratio)) {
      const pixels = resolveOutputPixels(
        capability.features.video_dimensions,
        params.resolution,
        params.aspect_ratio,
      );
      if (pixels !== null) {
        input.output_width = pixels.width;
        input.output_height = pixels.height;
      }
    }
    // IKDJNZ：单数组 references 冻结进 input 快照（保序），Worker 执行时按 role 拆帧/参考并做关联转换。
    const parsed = parseReferences(body.references);
    if (parsed.kind === "ok") {
      input.references = parsed.items;
    } else {
      const firstFrameAssetId = assetId(body.first_frame_asset_id);
      const lastFrameAssetId = assetId(body.last_frame_asset_id);
      if (firstFrameAssetId) input.first_frame_asset_id = firstFrameAssetId;
      if (lastFrameAssetId) input.last_frame_asset_id = lastFrameAssetId;
      if (referenceAssetIds.length > 0)
        input.reference_asset_ids = referenceAssetIds;
      // 素材库引用：冻结进 input 快照（仅 video）。零本地表，Worker 执行时转 asset:// 载体。
      // IKDJNZ：参考音频（type:"audio"）与图/视频一并冻结（对齐单数组 references 契约）。
      const firstFrameMaterialId = materialId(body.first_frame_material_id);
      const lastFrameMaterialId = materialId(body.last_frame_material_id);
      const materialRefsResolved = uniqueMaterialRefs(
        materialRefs(body.reference_materials) ?? [],
      );
      if (firstFrameMaterialId)
        input.first_frame_material_id = firstFrameMaterialId;
      if (lastFrameMaterialId)
        input.last_frame_material_id = lastFrameMaterialId;
      if (materialRefsResolved.length > 0)
        input.reference_materials = materialRefsResolved;
    }
    // IKDLQG：视频目标快照与图片同构——target_node_id + 当次文本附件正文。
    if (targetNodeId !== null) {
      input.target_node_id = targetNodeId;
      input.text_attachments = textAttachments;
    }
    return input;
  },
};

const audioStrategy: GenerationTypeStrategy = {
  validate(body) {
    // ADR-0086：音频参考分类上限读能力行（白名单解析后以 capability.features 重跑，见 pipeline）。
    return validateCommon(body, "audio") ?? validateAudioReferences(body);
  },
  composeInput({ body, resolvedModelId, promptText, targetNodeId, textAttachments }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      model_id: resolvedModelId,
    };
    // IKE4GC：音频参考素材冻结进 input 快照（保序）；Worker 执行时转 seed-audio references
    //   （audio→audio_url、image→image_url、已关联素材→asset://），不改 prompt。
    const parsed = parseReferences(body.references);
    if (parsed.kind === "ok") input.references = parsed.items;
    // IKDMQT：音频草稿目标冻结进快照（执行与重试只读，不回读画布）。
    // IKFCXE：音频目标与图片/视频同构——连线推导的文本附件正文一并冻结，
    //   执行与重试消费该快照（附件作为创作上下文与主提示词共同进入生成）。
    if (targetNodeId !== null) {
      input.target_node_id = targetNodeId;
      input.text_attachments = textAttachments;
    }
    return input;
  },
};

const strategies: Record<GenerationType, GenerationTypeStrategy> = {
  image: imageStrategy,
  video: videoStrategy,
  audio: audioStrategy,
};

/**
 * IKJ797：编辑单的报价/预扣时长口径 —— **按源参考视频最长时长预估**（官方 edit 语义：
 * 输出时长跟随参考视频，用户所选时长不生效）。延长单/参考单取用户所选，本函数不动它们。
 *
 * 堵的是 TEMP FIX 时代的透支漏洞：编辑 + 默认 4 秒档曾按 4 秒预估/冻结，而实际输出
 * 跟随源视频出十几秒——预扣与结算的差额由平台垫且账面无信号。
 *
 * ⚠️ **两个前提闸**：
 *   1. 能力行配了 `task_types.edit`（Seedance 2.5 配了、2.0 没配）——按模型分叉的
 *      约束走能力行配置，与 `resolveVideoTaskType`「只回答类型、不管约束」的分工一致；
 *   2. 现场用 {@link resolveVideoTaskType} 判定（报价发生在创建前、无快照可读；
 *      预扣发生在创建中，与 IKJ795 冻结进快照的是同一个纯函数同一份输入）。
 *
 * 源时长取 `input.references` 里 type=video 条目的 **duration 最大值**（多路素材时官方
 * 未写明跟随哪一路，父规格定为最长一路——保守方向是宁可多冻不少冻）。取整与
 * `sumVideoInputSeconds` 同口径（floor）。**量不到（有视频参考但缺时长）→ 不改写**，
 * 回落用户所选：报价侧等价于现状、预扣侧建任务链路已用 assets.duration 权威回填，
 * 量不到仅剩素材库引用未带时长的边角——不按 0 估，也不拒单。
 *
 * 原地改写 `input.duration`（预扣路径因此连快照一起改——worker 对编辑单的出站时长
 * 恒强制 -1、不读该字段；Java 结算 `specsOf` 读同一份快照，预扣与结算自动同口径）。
 * @returns 是否已按源视频时长改写（报价响应据此携带「按源视频时长预估」标记）。
 */
export function applyEditSourceDurationBasis(
  input: Record<string, unknown>,
  prompt: string,
  taskTypes: unknown,
): boolean {
  if (!hasTaskTypeConstraint(taskTypes, "edit")) return false;
  // 两处调用点的 input.references 都出自 parseReferences（role/type 恒为字符串），可直接窄化。
  const refs = Array.isArray(input.references)
    ? (input.references as ReadonlyArray<{
        role: string;
        type: string;
        duration?: unknown;
      }>)
    : [];
  if (resolveVideoTaskType(refs, prompt) !== "edit") return false;
  let maxSeconds: number | null = null;
  for (const ref of refs) {
    if (ref.type !== "video") continue;
    const seconds = ref.duration;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return false; // 有视频参考却量不到时长：整个键量不到，不凑偏小的数（同 sumVideoInputSeconds 立场）
    }
    maxSeconds = Math.max(maxSeconds ?? 0, Math.floor(seconds));
  }
  if (maxSeconds === null) return false;
  input.duration = maxSeconds;
  return true;
}

/** IKJGE6：视频参考时长的权威补齐（建任务与报价共用）。缺 `duration` 的本地视频引用按
 *  查得的素材时长（assets.duration，`resolveInputAssets` 顺带查出）回填；查不到或非正数
 *  保持原样——计价侧按「量不到源时长」回落（applyEditSourceDurationBasis 的既有立场）。
 *  素材库引用（material_id，本地零表）只能靠调用方带，不在本函数职责内。 */
export function withVideoReferenceDurations(
  references: ReadonlyArray<ReferenceItemInput>,
  secondsByAssetId: ReadonlyMap<string, number | null>,
): ReferenceItemInput[] {
  return references.map((item) => {
    if (item.type !== "video" || item.duration !== undefined || item.asset_id === undefined) {
      return item;
    }
    const seconds = secondsByAssetId.get(String(item.asset_id));
    return typeof seconds === "number" && seconds > 0 ? { ...item, duration: seconds } : item;
  });
}

/**
 * 报价（价格预览）用的规格投影 —— 喂给 billing 的 `Quote`，只算不扣。
 *
 * ⚠️ **走的就是上面这一个 `composeInput`**（建任务冻结 input 的同一份），不是另写一份
 *    「挑几个定价键」的投影。定价维度（模型 + 任务类型 + 规格 + 等级）只要有一处漂，
 *    用户就会看到「预览一个价、实扣另一个价」—— 那是会被当成扣错了的一类不一致。
 *    所以这里连能力位（features.audio ⇒ generate_audio 冻不冻）都交回给 composeInput 判，
 *    不在本函数里重写一遍。
 *
 * ⚠️ 只喂面板给得出的那部分：无画布目标、无参考素材。它们的差别进不了 specs —— 数组
 *    （references / input_asset_ids）被 `extractSpecs` 丢掉，scalar 的那几个快照键
 *    （target_node_id / first_frame_asset_id）不是定价维度。**prompt 单独删掉**：提示词是
 *    创作内容，不是定价维度，而带上它会让前端的查询键随每一次打字变化（每敲一个字重新报价）。
 *
 * 类型不支持、或请求体里没有可用的 parameters → 返回 null（调用方按「无报价」处置，不报错）。
 */
export function projectQuoteInput(
  type: GenerationType,
  body: CreateGenerationJobBody,
  capability?: ModelCapabilityView,
): Record<string, unknown> | null {
  const strategy = strategies[type];
  const params = body.parameters as GenerationParameters | undefined;
  if (!strategy || typeof params !== "object" || params === null) return null;

  // ★ 参考素材必须参与报价投影 —— 它**是**定价维度（Seedream 5.0 Pro：首张免费、
  //   第 2 张起 0.02 元/张）。这里原先写死 `referenceAssetIds: []`，那时它还不是；
  //   现在再写死，报价就会比实扣低一截（而「预览价 = 实扣价」正是这条投影的全部意义）。
  //
  //   走**与建任务同一个** `resolveReferenceAssets`（同一个去重、同一个超限判定），
  //   而不是让调用方自己数一个张数传进来：数出来的张数只要在去重口径上差一点
  //   （例如前端把重复素材算了两遍），报价就与实扣对不上。
  //
  //   超限时按空数组报价：那种请求建任务时本来就会 400，报价这里没必要跟着报错 ——
  //   它会退化成「不含参考费」的价，偏保守且不会被真的扣到。
  const imageReferenceMax =
    capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
  const referenceAssets = resolveReferenceAssets(body, type, imageReferenceMax);

  // IKJ795：视频报价与建任务同源判定任务类型（同函数同输入，结果一致），随 composeInput
  // 冻结进投影——specs 与 Hold 同键，「预览价 = 实扣价」不变式不受快照新字段影响。
  // 报价侧不做编辑/延长拒单（只算不扣，建任务入口自会 4xx）。
  const quoteVideoTaskType =
    type === "video"
      ? resolveVideoTaskType(
          (() => {
            const parsed = parseReferences(body.references);
            return parsed.kind === "ok" ? parsed.items : [];
          })(),
          isStr(params.prompt) ? params.prompt : "",
        )
      : undefined;

  const input = strategy.composeInput({
    body,
    params,
    resolvedModelId: resolveModelId(type, params.model_id),
    promptText: isStr(params.prompt) ? params.prompt : "",
    targetNodeId: null,
    textAttachments: [],
    referenceAssetIds: referenceAssets.ok ? referenceAssets.value.referenceAssetIds : [],
    ...(capability ? { capability } : {}),
    ...(quoteVideoTaskType !== undefined ? { videoTaskType: quoteVideoTaskType } : {}),
  });
  delete input.prompt;
  // 与建任务同口径：输出数也是定价维度（多图按张计价），它在建任务那边同样冻在 input 上。
  input.expected_output_count = Number(body.expected_output_count);
  return input;
}

// ---- pipeline 阶段 ----

/** 模型 id 原样取用，不做任何改写。
 *
 *  这里曾有一张 `VIDEO_MODEL_ALIASES = { "seedance-2": "doubao-seedance-2-0-260128" }` 的旧前端
 *  兼容表，在**白名单查询之前**改写 model_id。按「配置永远第一」，它是个反例：运营若真配一行
 *  model_id 就叫 `seedance-2`，请求会被改写成 2.0 那行，那一行永远赢不了。故删除。
 *
 *  删除依据：当前前端产品代码只发真实目录 id；本地画布草稿清点 `"seedance-2"` 零命中，
 *  存的都是 `doubao-seedance-2-0-260128` / `doubao-seedance-2-5-260628`。若有老客户端仍发别名，
 *  会在下面过白名单时以 400 MODEL_UNAVAILABLE 明确失败，而不是被静默改写。
 *
 *  最终 id 必须命中启用且 capability_type 匹配的目录行，否则 400（IK6T90）。 */
function resolveModelId(type: GenerationType, modelId: unknown): string {
  void type;
  return String(modelId);
}

/** 参考图字段语义统一（IKA72G）：image 参考图 = input_asset_ids（与前端契约/worker 对齐），
 *  video 普通参考素材 = reference_asset_ids；首尾帧走独立字段 first/last_frame_asset_id 不受此限。
 *  image 超限返回错误（含模型真实上限，回退常量 10）。 */
function resolveReferenceAssets(
  body: CreateGenerationJobBody,
  type: GenerationType,
  imageReferenceMax: number,
):
  | { ok: true; value: { referenceAssetIds: Array<string | number> } }
  | {
      ok: false;
      value: {
        message: string;
        code: string;
        params: { max_reference_count: number };
      };
    } {
  const inputAssetIds = (
    Array.isArray(body.input_asset_ids) ? body.input_asset_ids : []
  ) as number[];
  // IKG6EK / ADR-0088：图片端也认单数组 references（三端统一），保序取其 asset_id；
  // material_id 已在 validateRejectMaterialReferences 拦下（仅视频可用）。
  // 与旧字段同时出现时以 references 为准——前端切过来之前旧路径原样可用。
  const singleRefs = type === "image" ? parseReferences(body.references) : { kind: "absent" as const };
  // 空数组视为「未提供」：与音频端 hasContent 同口径——前端可能发 references: []（旧字段仍带内容），
  // 若把空数组当成"以 references 为准"，会把同请求里的 input_asset_ids 静默清空。
  if (singleRefs.kind === "ok" && singleRefs.items.length > 0) {
    // 去重保首见，与旧字段分支的 uniqueAssetIds 同口径：图片端每条都是 role=reference，
    // 重复没有语义（视频端的「同一素材双角色」由 providerUrl 查重另行为 400，不在此列）。
    // mergeTextProvidedReferences 只对新追加项去重，直接项内部的重复会原样穿过，故在此收口。
    const ids = [...new Set(singleRefs.items.map((item) => String(item.asset_id)))];
    if (ids.length > imageReferenceMax) {
      return {
        ok: false,
        value: {
          message: `参考图最多 ${imageReferenceMax} 张`,
          code: ERROR_UNSUPPORTED_INPUT,
          params: { max_reference_count: imageReferenceMax },
        },
      };
    }
    return { ok: true, value: { referenceAssetIds: ids } };
  }
  const explicitReferenceIds = assetIds(body.reference_asset_ids);
  const firstFrameAssetId = assetId(body.first_frame_asset_id);
  const lastFrameAssetId = assetId(body.last_frame_asset_id);
  const hasExplicitFrame =
    firstFrameAssetId !== null || lastFrameAssetId !== null;
  const referenceAssetIds =
    body.reference_asset_ids !== undefined
      ? uniqueAssetIds(explicitReferenceIds)
      : hasExplicitFrame
        ? []
        : inputAssetIds;
  if (type === "image" && referenceAssetIds.length > imageReferenceMax) {
    return {
      ok: false,
      value: {
        message: `参考图最多 ${imageReferenceMax} 张`,
        code: ERROR_UNSUPPORTED_INPUT,
        params: { max_reference_count: imageReferenceMax },
      },
    };
  }
  return { ok: true, value: { referenceAssetIds } };
}

interface TargetSnapshot {
  canvas?: { nodes: PromptTargetNode[]; edges: CanvasEdge[]; version: number };
  targetNodeId: string | null;
  textAttachments: TextAttachmentSnapshot[];
}

/** IKDLQF/IKFA1P：按画布边序推导连入目标的文本附件快照（前端 textAttachmentsOf 同源；
 *  IKFA1P 文本标签的编号与身份复核共用该顺序）。 */
function textAttachmentsFromCanvas(
  nodes: Array<{ id?: unknown; type?: unknown; data?: Record<string, unknown> }>,
  edgesRaw: unknown,
  targetNodeId: string,
): TextAttachmentSnapshot[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const attachments: TextAttachmentSnapshot[] = [];
  for (const edge of Array.isArray(edgesRaw) ? edgesRaw : []) {
    if (!edge || typeof edge !== "object") continue;
    const { source, target: edgeTarget } = edge as {
      source?: unknown;
      target?: unknown;
    };
    if (edgeTarget !== targetNodeId) continue;
    const sourceNode = byId.get(source);
    if (!sourceNode || sourceNode.type !== "textNode") continue;
    // IKDL9U 修复：富文本节点按文本投影消费（html 也计入），并快照 prompt_source
    const previewSource = previewSourceSchema.safeParse(
      sourceNode.data?.promptSource,
    );
    attachments.push({
      node_id: source as string,
      title:
        typeof sourceNode.data?.title === "string"
          ? sourceNode.data.title
          : "",
      text: extractTextNodeText(sourceNode.data),
      ...(previewSource.success
        ? { prompt_source: previewSource.data }
        : {}),
    });
  }
  return attachments;
}

/** IKFM3S §2/§3 + IKFM3W §10：图片/视频目标携带 target_node_id 时按最新画布派生文本带入参考
 *  ——失效索引、不支持的媒体类型、帧互斥（视频）、合并后超限在接纳当下 400（不静默丢素材）；
 *  后端权威并入：图片把 body 缺失项按推导序追加 input_asset_ids 尾部，视频以合并后的单数组
 *  references 返回（调用方以此替代 body.references 供 composeInput 与正文标签复核统一消费）。
 *  非图片/视频/音频或无目标时零影响（返回原直接参考，不读画布）。
 *  IKJGE6：导出供报价端点做同一合并——报价判定输入与建任务合并后引用集合同源。 */
export async function resolveTextIndexReferences(args: {
  type: GenerationType;
  body: CreateGenerationJobBody;
  projectId: string;
  deps: { canvas: Pick<CanvasRepo, "getByProject"> };
  directReferenceAssetIds: Array<string | number>;
  imageReferenceMax: number;
  /** IKFM3W/IKFM41：视频/音频目标的能力行（视频接受类型按 features 位；容量走 checkReferenceLimits） */
  capability?: ModelCapabilityView;
}): Promise<
  | {
      ok: true;
      value: {
        merged: Array<string | number>;
        index: TargetTextIndex;
        canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>> | null;
        /** 契约 §10/§11：视频/音频目标合并后的单数组 references（含文本带入追加项）；仅视频/音频返回 */
        videoReferences?: ReferenceItemInput[];
      };
    }
  | { ok: false; value: { message: string; code: string; params?: Record<string, unknown> } }
> {
  const targetNodeId =
    isStr(args.body.target_node_id) && args.body.target_node_id.trim() !== ""
      ? args.body.target_node_id
      : null;
  if (
    (args.type !== "image" && args.type !== "video" && args.type !== "audio") ||
    targetNodeId === null
  ) {
    return {
      ok: true,
      value: {
        merged: args.directReferenceAssetIds,
        index: { inputs: [], refs: [], invalid: [] },
        canvas: null,
      },
    };
  }
  const canvas = await args.deps.canvas.getByProject(args.projectId);
  const nodes = JSON.parse(canvas.nodes ?? "[]") as TextIndexCanvasNode[];
  const edges = JSON.parse(canvas.edges ?? "[]");
  const index = textIndexOfTarget(nodes, edges, targetNodeId);
  if (args.type === "video") {
    return resolveVideoTextIndexReferences(args, index, canvas);
  }
  if (args.type === "audio") {
    return resolveAudioTextIndexReferences(args, index, canvas);
  }
  const { merged } = mergeTextProvidedReferences(
    args.directReferenceAssetIds,
    index.refs,
  );
  const checkError = checkTextIndexSyncInput({
    index,
    acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
    mergedReferenceCount: merged.length,
    maxReferences: args.imageReferenceMax,
  });
  if (checkError) {
    if (checkError.kind === "invalid_index") {
      return {
        ok: false,
        value: { message: TEXT_INDEX_INVALID_MESSAGE, code: ERROR_INVALID_REFERENCE },
      };
    }
    if (checkError.kind === "unsupported_media_type") {
      return {
        ok: false,
        value: {
          message: TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
          code: ERROR_INVALID_REFERENCE_TYPE,
        },
      };
    }
    return {
      ok: false,
      value: {
        message: textIndexOverflowMessage(checkError.max),
        code: ERROR_UNSUPPORTED_INPUT,
        params: { max_reference_count: checkError.max },
      },
    };
  }
  return { ok: true, value: { merged, index, canvas } };
}

/** 视频目标的文本带入参考校验与并入（契约 §10）：失效索引 / 首尾帧互斥 / 不支持类型 400；
 *  文本带入一律普通参考，直接参考（单数组保序）在前追加尾部，同 assetId 去重保首见；
 *  容量校验在合并后走既有 checkReferenceLimits(features, …, "video") 分类上限。 */
function resolveVideoTextIndexReferences(
  args: { body: CreateGenerationJobBody; directReferenceAssetIds: Array<string | number>; capability?: ModelCapabilityView },
  index: TargetTextIndex,
  canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>>,
):
  | {
      ok: true;
      value: {
        merged: Array<string | number>;
        index: TargetTextIndex;
        canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>> | null;
        videoReferences?: ReferenceItemInput[];
      };
    }
  | { ok: false; value: { message: string; code: string } } {
  const features = args.capability?.features;
  // 接受类型按能力位（契约 §10）：image 恒接受；无能力行时维持旧行为（不拦视频/音频参考）
  const acceptedMediaTypes: MediaMentionType[] = ["image"];
  if (!features || features.video_reference) acceptedMediaTypes.push("video");
  if (!features || features.audio_reference) acceptedMediaTypes.push("audio");
  const parsed = parseReferences(args.body.references);
  const hasFrameRole =
    (parsed.kind === "ok" &&
      parsed.items.some((item) => item.role === "first_frame" || item.role === "last_frame")) ||
    args.body.first_frame_asset_id !== undefined ||
    args.body.last_frame_asset_id !== undefined ||
    args.body.first_frame_material_id !== undefined ||
    args.body.last_frame_material_id !== undefined;
  const checkError = checkVideoTextIndexSyncInput({
    index,
    acceptedMediaTypes,
    hasFrameRole,
  });
  if (checkError) {
    if (checkError.kind === "invalid_index") {
      return {
        ok: false,
        value: { message: TEXT_INDEX_INVALID_MESSAGE, code: ERROR_INVALID_REFERENCE },
      };
    }
    if (checkError.kind === "frame_conflict") {
      return {
        ok: false,
        value: { message: VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE, code: ERROR_INVALID_REFERENCE },
      };
    }
    return {
      ok: false,
      value: {
        message: TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
        code: ERROR_INVALID_REFERENCE_TYPE,
      },
    };
  }
  if (index.refs.length === 0) {
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }
  if (parsed.kind === "absent") {
    // 旧参考字段与文本带入并存 → 防御拒绝（新客户端提交一律走单数组；帧字段已由互斥拦截）
    if (hasContent(args.body.reference_asset_ids) || hasContent(args.body.reference_materials)) {
      return {
        ok: false,
        value: {
          message: "文本带入参考与旧参考字段不能混用，请使用 references 提交",
          code: ERROR_INVALID_REFERENCE,
        },
      };
    }
    const videoReferences = textProvidedVideoReferences([], index.refs);
    const limitErr = videoReferenceLimitError(features, videoReferences);
    if (limitErr) {
      return { ok: false, value: { message: limitErr, code: ERROR_INVALID_REFERENCE } };
    }
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas, videoReferences } };
  }
  if (parsed.kind === "invalid") {
    // validateVideo 已拒非法 references，此处不可达；保守放行原样（不改变既有错误）
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }
  const videoReferences = [
    ...parsed.items,
    ...textProvidedVideoReferences(parsed.items, index.refs),
  ];
  const mergedLimitErr = videoReferenceLimitError(
    features,
    videoReferences.filter((item) => item.role === "reference"),
  );
  if (mergedLimitErr) {
    return { ok: false, value: { message: mergedLimitErr, code: ERROR_INVALID_REFERENCE } };
  }
  return {
    ok: true,
    value: { merged: args.directReferenceAssetIds, index, canvas, videoReferences },
  };
}

/** 视频文本带入合并后的容量校验（契约 §10）：分类上限全部读能力行。
 *
 *  `features` 为空时**不判数量**——此前按写死的「图/视频并集 ≤ 12」判，那是一处「配置说了不算」：
 *  运营把上限配到 12 以上会被它先拒掉。该分支实际不可达（调用链上游的白名单守卫要求模型必须
 *  在启用目录内，未命中直接 400 MODEL_UNAVAILABLE，因此能力行必然已解析），留一个显式的
 *  配置缺失出口，而不是一个看起来像规则的魔数。 */
function videoReferenceLimitError(
  features: ModelFeatures | undefined,
  references: ReadonlyArray<ReferenceItemInput | TextProvidedVideoReference>,
): string | null {
  if (!features) return null;
  const items = references.map((item) => ({
    type: item.type,
    duration: "duration" in item && typeof item.duration === "number" ? item.duration : undefined,
  }));
  return checkReferenceLimits(features, items, "video");
}

/** 音频目标的文本带入参考校验与并入（契约 §11 IKFM41）：失效索引 / 不支持类型（video）400；
 *  文本带入恒普通参考（音频无角色槽），直接参考（单数组保序）在前追加尾部，同 assetId 去重
 *  保首见；容量与 audio/image 混用在合并后走既有 checkReferenceLimits(features, …, "audio")
 *  （audio ≤ audio_reference_max、image ≤ image_reference_max、不可混用），无能力行维持
 *  validateAudioReferences 旧口径（不查分类上限）。 */
function resolveAudioTextIndexReferences(
  args: { body: CreateGenerationJobBody; directReferenceAssetIds: Array<string | number>; capability?: ModelCapabilityView },
  index: TargetTextIndex,
  canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>>,
):
  | {
      ok: true;
      value: {
        merged: Array<string | number>;
        index: TargetTextIndex;
        canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>> | null;
        videoReferences?: ReferenceItemInput[];
      };
    }
  | { ok: false; value: { message: string; code: string } } {
  const features = args.capability?.features;
  const checkError = checkAudioTextIndexSyncInput({
    index,
    acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  });
  if (checkError) {
    if (checkError.kind === "invalid_index") {
      return {
        ok: false,
        value: { message: TEXT_INDEX_INVALID_MESSAGE, code: ERROR_INVALID_REFERENCE },
      };
    }
    return {
      ok: false,
      value: {
        message: TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
        code: ERROR_INVALID_REFERENCE_TYPE,
      },
    };
  }
  if (index.refs.length === 0) {
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }
  const parsed = parseReferences(args.body.references);
  if (parsed.kind === "invalid") {
    // validateAudioReferences 已拒非法 references，此处不可达；保守放行原样（不改变既有错误）
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }
  // 音频禁旧参考字段（validateAudioReferences 拦截），references 缺失时以文本带入项新建单数组
  const audioReferences: ReferenceItemInput[] = [
    ...(parsed.kind === "ok" ? parsed.items : []),
    ...textProvidedAudioReferences(parsed.kind === "ok" ? parsed.items : [], index.refs),
  ];
  const limitErr = features
    ? checkReferenceLimits(
        features,
        audioReferences.map((item) => ({ type: item.type })),
        "audio",
      )
    : null;
  if (limitErr) {
    return { ok: false, value: { message: limitErr, code: ERROR_INVALID_REFERENCE } };
  }
  return {
    ok: true,
    value: { merged: args.directReferenceAssetIds, index, canvas, videoReferences: audioReferences },
  };
}

/** 把文本带入参考按来源文本卡聚合为附件 media 冻结映射（IKFM3S §5）。 */
function textAttachmentMediaOf(index: TargetTextIndex): Map<string, TextAttachmentMedia[]> {
  const mediaByTextNode = new Map<string, TextAttachmentMedia[]>();
  for (const item of index.refs) {
    const list = mediaByTextNode.get(item.textNodeId) ?? [];
    list.push({
      node_id: item.sourceNodeId,
      asset_id: item.assetId,
      media_type: item.mediaType,
    });
    mediaByTextNode.set(item.textNodeId, list);
  }
  return mediaByTextNode;
}

/** IKDLQF/IKDLQG/IKDMQT/IKFCXE：携带 target_node_id 时，接纳当下读取最新 Canvas 校验目标节点；
 *  文本附件推导覆盖图片/视频/音频（IKFCXE 解除音频限制），空 prompt 由组合校验拒绝。
 *  IKG6EK / ADR-0088：正文一律取 parameters.prompt；prompt_doc 已退役，不再有编号清单组合。 */
async function resolveTargetSnapshot(args: {
  type: GenerationType;
  body: CreateGenerationJobBody;
  promptText: string;
  projectId: string;
  deps: Pick<GenerationDeps, "canvas">;
  /** 同次画布读取：文本附件与目标坐标系必须来自同一版本，不得二次读取。 */
  canvas?: Awaited<ReturnType<CanvasRepo["getByProject"]>>;
  /** IKFM3S：图片目标的文本索引派生结果——附件冻结 media 映射用（缺省无媒体）。 */
  textIndex?: TargetTextIndex;
  referenceAssetIds: readonly string[];
}): Promise<
  | { ok: true; value: TargetSnapshot }
  | { ok: false; value: { message: string; code: string } }
> {
  const { type, body, promptText, projectId, deps } = args;
  const targetNodeId =
    isStr(body.target_node_id) && body.target_node_id.trim() !== ""
      ? body.target_node_id
      : null;
  let textAttachments: TextAttachmentSnapshot[] = [];
  let canvasSnapshot: TargetSnapshot["canvas"];
  if (targetNodeId !== null) {
    const canvas = args.canvas ?? await deps.canvas.getByProject(projectId);
    const nodes = JSON.parse(canvas.nodes ?? "[]") as Array<{
      id?: unknown;
      type?: unknown;
      data?: Record<string, unknown>;
    }>;
    canvasSnapshot = { nodes: nodes as PromptTargetNode[], edges: JSON.parse(canvas.edges ?? "[]"), version: canvas.version! };
    const target = nodes.find((node) => node.id === targetNodeId);
    const typeLabel =
      type === "video" ? "视频" : type === "audio" ? "音频" : "图片";
    if (
      !target ||
      target.type !== "mediaNode" ||
      target.data?.mediaType !== type
    ) {
      return {
        ok: false,
        value: {
          message: `目标节点不存在或不是${typeLabel}媒体节点`,
          code: ERROR_INVALID_INPUT,
        },
      };
    }
    // IKFCXE：音频与图片/视频同源推导文本附件（画布边序），冻结进 input.text_attachments；
    // 附件是创作上下文，不改变主提示词的必要性——音频不允许仅凭附件正文驱动生成。
    textAttachments = textAttachmentsFromCanvas(
      nodes,
      JSON.parse(canvas.edges ?? "[]"),
      targetNodeId,
    );
    // IKFM3S §5：以最终参考编号编译绑定区间；worker 直接消费冻结正文。
    if (args.textIndex && args.textIndex.refs.length > 0) {
      const mediaByTextNode = textAttachmentMediaOf(args.textIndex);
      const parsed = parseReferences(body.references);
      const finalRefs = parsed.kind === "ok" ? parsed.items.map((item) => ({
        id: String(item.asset_id ?? item.material_id), role: item.role, type: item.type,
      })) : [];
      // IKG6EK / ADR-0088：图片端的编号基准是**合并后的全量参考**（图片目标已由闸保证全是图片），
      // 与其它端同投影——编号规则只此一套（videoRefLabel 的同类型计数）。
      const imageRefItems = args.referenceAssetIds.map((id) => ({
        id: String(id), role: "reference" as const, type: "image" as const,
      }));
      textAttachments = textAttachments.map((attachment) => {
        const media = mediaByTextNode.get(attachment.node_id);
        if (!media?.length) return attachment;
        const data = nodes.find((node) => node.id === attachment.node_id)?.data;
        const mentions = (Array.isArray(data?.mediaMentions) ? data.mediaMentions : [])
          .flatMap((raw) => {
            const parsedMention = mediaMentionSchema.safeParse(raw);
            return parsedMention.success ? [parsedMention.data] : [];
          }).sort((a, b) => b.start - a.start);
        // 区间基于 Markdown 源；从后向前替换避免编号长度变化移动后续区间。
        let text = typeof data?.text === "string" ? data.text : attachment.text;
        for (const mention of mentions) {
          if (!media.some((item) => item.node_id === mention.nodeId && item.asset_id === mention.assetId)) continue;
          const label = videoRefLabel(mention.assetId, type === "image" ? imageRefItems : finalRefs);
          if (label !== null) text = text.slice(0, mention.start) + label + text.slice(mention.end);
        }
        return { ...attachment, text, media };
      });
    }
    // IKH8AU：正文由提交方给全（ADR-0088），服务端不再组合——长度闸已在入口按**正文全文**口径把关
    // （原组合闸把附件前缀又加了一遍，等于重复计数）。这里只留「一处有效文本都没有」的拒绝。
    if (promptText.trim() === "") {
      return {
        ok: false,
        value: { message: "prompt 无效", code: ERROR_INVALID_INPUT },
      };
    }
  }
  return { ok: true, value: { targetNodeId, textAttachments, ...(canvasSnapshot ? { canvas: canvasSnapshot } : {}) } };
}

interface GenerationDeps {
  projects: Pick<ProjectRepo, "findOwnedById">;
  command: GenerationCommandRepo;
  /** 能力目录白名单（启用 + 未软删，按 capability_type 过滤）。 */
  models: Pick<ModelCapabilityRepo, "listEnabledByType">;
  /** IKDLQF：携带 target_node_id 时于接纳当下读取最新画布推导有序文本附件。 */
  canvas: Pick<CanvasRepo, "getByProject">;
  /** IKE7JP：提交时复用 worker resolveInputAssets 查参考素材存在性/类型（归属逻辑单份）。 */
  assets: Pick<AssetOwnershipOps, "resolveInputAssets">;
  /**
   * ★ 新计费（billing-svc）：**预扣**与它的**失败补偿**。由装配层注入 —— 它负责解析
   * 用户等级、提取规格、调 billing 客户端；本函数只把「哪个用户、哪个 job、什么模型/
   * 任务」交给它。
   *
   * <p>调用时机在**建 job 的同一个事务里、job 行插入之后**（见 generation-command-repo）：
   * 预扣失败整体回滚，不产生垃圾 job；而预扣**成功之后**事务才失败时，由 release 把这笔
   * 冻结退掉 —— billing 是外部服务，不跟我们的数据库回滚走。两者成对：缺了 release 就会
   * 留下一笔没有对应任务的冻结（永远冻着）。
   *
   * <p>实现抛出的异常（余额不足 / billing 不可用）会原样冒泡，由上层翻成对用户的响应
   * （fail closed —— 扣不动就不要开始干活）。
   *
   * <p>⚠️ **同一 Idempotency-Key 重复提交不会重复 Hold**：第二次提交在第 2 步的幂等查询就
   * 重放首次结果并返回，根本走不到这里。并发同键由唯一索引只放一个事务进，输家整体回滚
   * （含它那笔预扣，由下面的补偿退掉），回读赢家结果——两个请求同一个 job、同一笔预扣。
   * <p>两点不要弄反：
   * <ul>
   *   <li>`actionIdentity`（commandId 的来源）里**必须**带 `Date.now()`，即同一把 key 的
   *       两次提交本就不同。⚠️ **不能**把它改成「同键恒定」：billing 的幂等记录是**永久**的
   *       （`hold:{commandId}` 进账本），而它的重放分支按 **job_id** 找预留
   *       （CreditService.hold → `reservations.findByJobId(jobId)`）。在「预扣成功、事务
   *       随后回滚（已被补偿退掉）」这条路径上，事务连同幂等行一起没了，重试会建一个新
   *       job；此时若 commandId 恒定，billing 命中永久幂等记录却找不到新 job 的预留 ⇒ 抛
   *       IllegalStateException，那把 key 此后**永远**提交不了。</li>
   *   <li>「重试不重复扣」这条保证落在**幂等表 + 补偿**上，不落在 commandId 的稳定性上：
   *       命中幂等的那次不扣钱（走不到这里），交易失败的那次由 release 退钱。</li>
   * </ul>
   * <p>⚠️ billing 契约里 `HoldRequest.command_id` 那条注释（「客户端生成的幂等键，让 Hold 能
   * 发生在写 job 之前」）在本仓落不了地：billing 的预留与结算都以 job_id 为准，而 job id 只有
   * 行插进去之后才存在（见 job-billing 的说明）。本仓走的是另一条等价的路——幂等表复用同一个
   * job 行，重放不发生新的预扣。
   */
  billing?: {
    hold: BillingHold;
    release: BillingRelease;
  };
  /** IKIZQ8：样片提交确认的复算依赖（与报价入口同一个 createBillingQuote 装配——
   *  同一套规格归一、同一个 resolveTier，否则「提交核对」与「用户看到的报价」会漂）。
   *  只在 parameters.sample_mode=true 的样片分支读取；普通视频创建不碰它。
   *  缺省（未接线）时样片提交按无报价拒绝（fail closed），普通路径零影响。 */
  quote?: BillingQuote;
  /** IKF YHJ：素材校验状态门（ADR-0087）。提供时，视频生成采纳素材库引用前判定其可用性。
   *  返回 null = 放行；返回字符串 = 面向用户的拒绝原因（400，零写入）。
   *  缺省不接（未接线时行为与改造前一致），便于灰度与单测隔离。 */
  materialGate?: MaterialGate;
}

/** IKF YHJ：素材校验状态门的最小接口（实现见 material-compliance-gate.ts + 控制器接线）。 */
export interface MaterialGate {
  assertInputUsable(input: {
    userId: string;
    /** 已冻结的任务 input——素材 id 与本地 Asset id 都在里面，由实现自行汇集。 */
    jobInput: Record<string, unknown>;
    /** 任务类型。本门只对 video 生效（素材库绑定只有视频参考会消费），实现方按此短路。 */
    jobType: string;
  }): Promise<string | null>;
}

/** 视频参考投影：提交 references 单数组按提交结构编译——引用标记转移与标签派生共用同一投影。 */
function videoRefItemsOf(v: unknown): VideoRefItem[] {
  const parsed = parseReferences(v);
  return parsed.kind === "ok"
    ? parsed.items.map((item) => ({
        id: String(item.asset_id ?? item.material_id),
        role: item.role,
        type: item.type,
      }))
    : [];
}

/** Idempotency-Key 长度上限，对齐 `command_idempotency.idempotency_key` 的列宽 VarChar(128)：
 *  超长在这里明确拒（400），而不是拖到落库那一刻以 MySQL 截断/报错的形式变成 500。
 *  截断尤其不能接受——它会把两把不同的钥匙并成一把。 */
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/** 摘要用的规范化 JSON：对象**按键名排序**递归展开。
 *
 *  ⚠️ 不能直接用 `JSON.stringify(body)`：那保留客户端序列化时的键序，于是「同一份载荷、
 *  两次发送时键序不同」会被摘要判成**同键异载荷**，把一个正常的重试拒成冲突。
 *  要的是「摘要只取决于请求语义」——键序是传输细节，不是语义。与先例同一条口径
 *  （video-scene-splits 的 requestHashOf「显式定序拼接、规避 JSON 键序漂移」、
 *  scene-cards.controller 的 method:path:content）；那边键少可以逐个拼，建任务的载荷是
 *  一整个生成参数对象、键还随类型变，所以这里用「排序后序列化」达到同一效果。
 *  （重试端点摘要的是**原始 body 字符串**，天然没这个问题；建任务拿到的是已解析对象。） */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      // undefined 属性在 JSON.stringify 里会被丢掉，这里同口径，免得两者摘要分叉。
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 建任务请求摘要（method + operation + 资源路径 + 规范化 body），sha256 hex 定长 64。
 *  与 {@link generationRetryRequestHash} 同形同源：两个入口的「同键异载荷」判定必须一套口径。 */
export function generationCreateRequestHash(
  projectId: string,
  body: CreateGenerationJobBody,
): string {
  return createHash("sha256")
    .update(
      `POST:${CREATE_GENERATION_JOB_OPERATION}:/projects/${projectId}/generation-jobs:${canonicalJson(body)}`,
    )
    .digest("hex");
}

/** 建任务结果 → 响应信封。
 *
 *  「同键异载荷」（同一把钥匙配了不同的载荷）判**冲突并报错**，不静默返回首次结果：
 *  静默重放会把「用户改了参数再提交」悄悄变成「又拿到那个旧任务」——他以为提交的是新参数，
 *  拿到的却是另一个任务，这比报错难查得多。同键同载荷的重放走 `ok(result)`，
 *  响应体与第一次完全一致（含 `generation_job_id`）。与重试端点同码同文案。 */
function createJobEnvelope(result: CreateJobResult) {
  return "kind" in result
    ? fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷")
    : ok(result);
}

/** POST /api/projects/{projectId}/generation-jobs：创建生成任务（queued）+ 预留点数 + 日志。
 *  单输出语义；action_identity 用 Idempotency-Key 派生（仅用于追溯）。
 *  幂等（`command_idempotency`，operation=generation.create）：同键同载荷重放首次结果，
 *  同键异载荷判冲突——见下面第 2 步与 {@link createJobEnvelope}。
 *  IKDZI1：流水线化——项目校验 → **幂等重放** → 类型校验（策略分派）→ 模型白名单 →
 *  参考图语义统一 → 画布目标快照 → 组装 input（策略分派）→ 预留点数 → 建任务。 */
export async function handleCreateGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  idempotencyKey: string | null,
  deps: GenerationDeps,
  internal: { providerCredential?: string } = {},
) {
  // 1. 项目归属（不泄漏存在性）
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  // 2. 幂等（command_idempotency，operation=generation.create）。
  //
  // ⚠️ 位置在**任何依赖当前状态的校验之前**：模型白名单、素材状态门、画布目标快照都可能
  // 在两次提交之间变了，而重放的是**既有结果**，不该被此刻的状态改写——「同一个请求被重试」
  // 这件事的答案在第一次提交时就已经定了。与 retryJob 的 `guardInput` 位置约定同源。
  //
  // 客户端没带（或只发了空白）Idempotency-Key → 完全不接幂等，行为与加幂等表之前一致：
  // 每次提交都是新任务，不强制要求这个头（老客户端不受影响）。
  const normalizedKey = (idempotencyKey ?? "").trim();
  if (normalizedKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(PARAM_MISSING_CODE, `Idempotency-Key 过长（上限 ${IDEMPOTENCY_KEY_MAX_LENGTH} 字符）`);
  }
  const idempotency: CreateJobIdempotency | null =
    normalizedKey === ""
      ? null
      : {
          key: normalizedKey,
          requestHash: generationCreateRequestHash(projectId, body),
        };
  if (idempotency) {
    const replayed = await deps.command.lookupCreateIdempotency(
      projectId,
      idempotency,
    );
    if (replayed) return createJobEnvelope(replayed);
  }

  // 3. 类型分派 + 校验（ADR-0086：视频/音频参考限制校验读能力行 features，先于模型白名单解析前
  //    以旧默认值运行，白名单解析后以 capability.features 重跑一次）
  const type = body.type as GenerationType;
  const strategy = strategies[type];
  if (!strategy)
    return fail(errorCodeToNumeric(ERROR_UNSUPPORTED_TYPE), "暂不支持该生成类型", {
      code: ERROR_UNSUPPORTED_TYPE,
    });
  // IKG6EK / ADR-0088：`prompt_doc` 已退役——提交方给正文全文，引用标记转移在接纳管线完成。
  // 为兼容当前版本前端，**携带时不报错、直接不读**（发了也不生效）；前端票要求其停止发送。
  const validateErr = strategy.validate(body);
  if (validateErr)
    return fail(errorCodeToNumeric(validateErr.code), validateErr.message, {
      code: validateErr.code,
    });

  // 4. 模型白名单（别名解析 + 能力目录命中）
  const params = body.parameters as GenerationParameters;
  const expectedOutputCount = Number(body.expected_output_count);
  let promptText = isStr(params.prompt) ? params.prompt : "";
  const resolvedModelId = resolveModelId(type, params.model_id);
  const whitelist = await deps.models.listEnabledByType(type);
  if (!whitelist.some((m) => m.model_id === resolvedModelId)) {
    return fail(errorCodeToNumeric(ERROR_MODEL_UNAVAILABLE), "model_id 不在可用模型白名单或已停用", {
      code: ERROR_MODEL_UNAVAILABLE,
    });
  }

  // 5. 参考图语义统一 + image 上限（IKA72G）
  // IKHEXG：上限键并入 `image_reference_max`（原 max_reference_images 不复存在）；
  // 图片/视频链路的缺省是 DEFAULT_IMAGE_REFERENCE_MAX = 10（音频链路的 1 是另一个常量）。
  const capability = whitelist.find((m) => m.model_id === resolvedModelId);
  // IKIZQ7：样片增量门控（fail closed）——与报价入口共用 ruleSampleMode 一条判定。
  // 能力行未声明 features.sample_mode（默认关闭）或请求形态不合契约（非 video / 非 480p /
  // 非字面 true）→ 400 明确拒绝样片提交；未传或 false 零影响（普通视频创建语义）。
  const sampleRuling = ruleSampleMode({
    type,
    sampleMode: params.sample_mode,
    resolution: params.resolution,
    expectedOutputCount,
    capability,
  });
  if (sampleRuling.kind === "rejected") {
    return fail(errorCodeToNumeric(sampleRuling.code), sampleRuling.message, {
      code: sampleRuling.code,
    });
  }
  const imageReferenceMax =
    capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
  // ADR-0086 / IKHBDO：视频/音频参考限制**只认能力行 features**。上方 strategy.validate 的预检
  // 发生在白名单解析之前，拿不到 capability，因此它不判参考数量（见 validateVideo 注释）；数量在
  // 此处以真实 features 判定（超限在接纳当下 400，含模型真实上限文案）。
  // 不变式：`capability` 对本行之后的所有代码恒有值——它取自已通过上方白名单校验的同一个
  // `whitelist`（`some(m => m.model_id === resolvedModelId)` 为真 ⇒ 同谓词的 `find` 必命中），
  // 白名单未命中的请求已在上面 400 返回。故 `type === "video" | "audio"` 的请求**必然**走到这次重跑。
  if (capability && (type === "video" || type === "audio")) {
    const revalidated =
      type === "video"
        ? validateVideo(body, capability)
        : validateAudioReferences(body, capability.features);
    if (revalidated)
      return fail(errorCodeToNumeric(revalidated.code), revalidated.message, {
        code: revalidated.code,
      });
  }
  // ADR-0085（IKESD6）/ IKH4B8：提示词长度上限**模型配置优先**，未配置回落缺省
  // （图片/视频 4000、音频 3000）；错误码与旧 validateCommon 一致。
  // 「提示词」= 提交上来的正文全文（ADR-0088：前端已把附件与输入拼好），故全仓只此一道闸。
  const maxPromptLength = resolvePromptMaxLength(type, capability?.features?.max_prompt_length ?? null);
  if (promptText.length > maxPromptLength)
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "prompt 无效", {
      code: ERROR_INVALID_INPUT,
    });
  // IKE7JP：Dock 提交时前置校验 resolution/size/aspect_ratio/duration 对能力目录合法性——
  // 越界值在接纳当下 4xx 返回（capability_unsupported_* 细分码 + 可用值文案），不拖到 worker 执行期。
  // 仅视频校验时长；图片无时长。SceneCard 路径已有同源 checkCapabilityLimit（下一步迁移共享）。
  // 仅当请求明确携带尺寸/比例/时长时才校验（缺省由能力默认值兜底，见 checkCapabilityLimit 同源语义）；
  // 图片路径允许缺 size（能力行默认尺寸）。duration 单独存在也进入校验（review：防只带时长越界漏网）。
  // IKJFGQ：视频段的档位校验随任务类型判定整体移到文本带入合并之后（见 effectiveBody 段注释）——
  // 判定输入已统一为合并后的引用集合，此处只留图片路径。
  if (
    capability &&
    type !== "video" &&
    type !== "audio" &&
    (params.size !== undefined || params.resolution !== undefined)
  ) {
    const checked = toGenerationParamCheckInput({
      resolution: params.resolution,
      size: params.size,
      aspect_ratio: params.aspect_ratio,
      duration: undefined,
    });
    if (checked) {
      const limitErr = checkGenerationParamLimit(
        {
          supported_sizes: capability.supported_sizes,
          supported_aspect_ratios: capability.supported_aspect_ratios,
          supported_durations: capability.supported_durations,
          task_types: capability.features?.task_types,
        },
        checked,
      );
      if (limitErr) {
        return fail(errorCodeToNumeric(limitErr.code), limitErr.reason, {
          code: limitErr.code,
        });
      }
    }
  }
  // IKE7JP：图片 size×ratio 交叉格前置——GPT 交叉格未填 / banana 一维映射缺失的组合
  // 在接纳当下 400（invalid_reference_type，与 worker mapImageChannelRequest 同码同文案），不拖到执行期。
  if (type === "image" && capability) {
    const mapping = parseStoredImageRequestMapping(
      channelOf(parseStoredChannel(capability.channel, "image")).parser,
      capability.request_mapping,
      { sizeId: capability.default_size, ratioId: capability.default_aspect_ratio },
    );
    if (mapping.parser !== "seedream") {
      // GPT 交叉格对未填组合可回退默认交叉格（与 worker mapImageChannelRequest 同源逻辑）；
      // banana 一维映射缺任一侧同样回退默认。仅当回退后仍无法拼出请求才 400。
      const sizeId = isStr(params.size) ? params.size : null;
      const ratioId = isStr(params.aspect_ratio) ? params.aspect_ratio : null;
      const mapped = mapImageChannelRequest(mapping, sizeId, ratioId);
      if (!mapped.ok) {
        return fail(
          errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE),
          "模型、分辨率与宽高比组合不受支持",
          {
            code: ERROR_INVALID_REFERENCE_TYPE,
          },
        );
      }
    }
  }
  // IKG0FR：视频分辨率不再前置换算像素。分辨率合法性已由上方 checkGenerationParamLimit 的
  // 能力行白名单负责（按 supported_sizes 的 id / api_value 比对）。像素只用于回写
  // assets.width/height（列可空），换算不出写 null 即可——不能把「本地算不出」当成「参数非法」，
  // 否则上游档位命名不遵循 <N>p 时会被误伤（如火山 Seedance 2.0 的 4k 档）。
  const refs = resolveReferenceAssets(body, type, imageReferenceMax);
  if (!refs.ok) {
    return fail(errorCodeToNumeric(refs.value.code), refs.value.message, {
      code: refs.value.code,
      params: refs.value.params,
    });
  }
  // IKFM3S §2/§3 + IKFM3W §10 + IKFM41 §11：图片/视频/音频目标文本带入参考——按最新画布
  // 派生、能力校验并权威并入（图片：body 缺失项追加 input_asset_ids 尾部；视频/音频：以合并后
  // 的单数组 references 替代）；后续存在性/类型复核与冻结统一用合并结果。
  const textIndexRefs = await resolveTextIndexReferences({
    type,
    body,
    projectId,
    deps,
    directReferenceAssetIds: refs.value.referenceAssetIds,
    imageReferenceMax,
    ...(capability ? { capability } : {}),
  });
  if (!textIndexRefs.ok) {
    return fail(
      errorCodeToNumeric(textIndexRefs.value.code),
      textIndexRefs.value.message,
      {
        code: textIndexRefs.value.code,
        ...(textIndexRefs.value.params
          ? { params: textIndexRefs.value.params }
          : {}),
      },
    );
  }
  const referenceAssetIds = textIndexRefs.value.merged;
  // IKFM3W §10 / IKFM41 §11：视频/音频目标以合并后的 references 供 composeInput 与正文标签
  // 复核统一消费（文本带入追加项已含；references 缺失且画布有文本带入时为新建的单数组）。
  // ⚠️ let 而非 const：视频参考的时长在下方的素材复核段被补进 references（见 IKARVx 段），
  //    那里替换的是整个 references 数组而不是原地改元素（`body` 可能是调用方传进来的对象，
  //    原地改会连带改到调用方）。
  let effectiveBody: CreateGenerationJobBody = textIndexRefs.value.videoReferences
    ? { ...body, references: textIndexRefs.value.videoReferences }
    : body;
  // IKJ795 / IKJFGQ：视频任务类型**只判一次**——接纳校验与快照冻结共用同一结果，下游（执行/报价）
  // 读冻结字段、不现场重算。IKJFGQ 起判定输入统一为**文本带入合并后**的引用集合（effectiveBody）：
  // 报价侧 applyEditSourceDurationBasis 对合并后的 input.references 现场重判，冻结值若读合并前的
  // 原始 body.references，「视频参考仅来自画布文本带入 + 提示词带编辑意图」会让两处分叉（冻结值
  // default 不拦比例、计价按编辑口径改写时长）。判定用主提示词（不含文本附件）；标记转移只把
  // &身份& 换成 @图片N 一类标签（不含意图关键词），转移前后对判定等价。视频恒判定（不依赖
  // size/resolution/duration 携带）——编辑/延长 + 非 adaptive 比例的拒单不能因为没带分辨率档而漏网。
  let videoTaskType: VideoTaskType | undefined;
  if (type === "video") {
    const parsedRefs = parseReferences(effectiveBody.references);
    videoTaskType = resolveVideoTaskType(
      parsedRefs.kind === "ok" ? parsedRefs.items : [],
      promptText,
    );
  }
  // IKE7JP（视频段，随判定迁移到合并后）：仅当请求明确携带尺寸/比例/时长时才校验（缺省由能力
  // 默认值兜底）；视频恒进（aspect_ratio 由 validateCommon 必填）——编辑/延长 + 非 adaptive 的
  // task_type_param_constraint 拒单对所有视频提交形态生效，不限带档位的请求。
  // IKFPYX：命中 features.task_types 时按任务类型约束校验（含 duration=-1 放行），
  // 否则回落基础能力行；任务类型读上面的单次判定结果（videoTaskType）。
  if (capability && type === "video") {
    const checked = toGenerationParamCheckInput({
      resolution: params.resolution,
      size: params.size,
      aspect_ratio: params.aspect_ratio,
      duration: params.duration,
    });
    if (checked) {
      const limitErr = checkGenerationParamLimit(
        {
          supported_sizes: capability.supported_sizes,
          supported_aspect_ratios: capability.supported_aspect_ratios,
          supported_durations: capability.supported_durations,
          task_types: capability.features?.task_types,
        },
        videoTaskType ? { ...checked, task_type: videoTaskType } : checked,
      );
      if (limitErr) {
        return fail(errorCodeToNumeric(limitErr.code), limitErr.reason, {
          code: limitErr.code,
        });
      }
    }
  }
  // IKJ795：编辑/延长 + 非 adaptive 比例的结构化拒单（task_type_param_constraint，不扣费 4xx）。
  // 独立于上面那段档位校验：视频可以只带比例不带档位（toGenerationParamCheckInput 对该形态
  // 返回 null），而这道约束只关乎比例，不能因缺档位漏网。判定输入读上面冻结的 videoTaskType
  // （不现场重算）；约束按能力行 task_types 配置——未配置该类型（2.0 形态）不拦，官方允许
  // 2.0 编辑任务指定比例。首帧/首尾帧走 validateVideo 既有闸，不在此重复。
  if (capability && type === "video" && (videoTaskType === "edit" || videoTaskType === "prolong")) {
    const allowed = taskTypeAllowedRatios(capability.features?.task_types, videoTaskType);
    const ratio = isStr(params.aspect_ratio) ? params.aspect_ratio : "";
    if (allowed && !allowed.includes(ratio)) {
      return fail(
        errorCodeToNumeric(ERROR_TASK_TYPE_PARAM_CONSTRAINT),
        TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
        { code: ERROR_TASK_TYPE_PARAM_CONSTRAINT },
      );
    }
  }
  // IKE7JP：提交时前置查参考素材存在性/类型——复用 worker resolveInputAssets（归属逻辑单份：
  // 项目直属 ∪ 全局 ∪ project_asset 关联）。缺失/无权访问在接纳当下 400，不拖到 worker 执行期。
  // 仅本地 Asset 引用需要查存在性；素材库引用（asset:// 载体）由上游强校验，格式已在前置校验。
  // code 与 worker 侧 resolveInputAssets 失败同源（review：参考不可用归 invalid_reference，
  // 类型不符归 invalid_reference_type，避免提交 gate 与 worker 兜底码漂移）。
  // 注：图片目标的全量参考已并入 referenceAssetIds（merged），故本段对图片即是全量复核。
  if (type !== "audio" && referenceAssetIds.length > 0) {
    const ids = referenceAssetIds.map(String);
    const resolved = await deps.assets.resolveInputAssets(ids, userId, projectId);
    if (resolved.length !== ids.length) {
      // IKG6EK / ADR-0088：doc 退役后不再按 doc 声明细化缺失索引文案，统一走通用信封。
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), "参考素材不存在或无权访问", {
        code: ERROR_INVALID_REFERENCE,
      });
    }
    // 图片参考必须是图片（worker 同源校验）；视频参考允许图/视频（首尾帧必须图片已由
    // strategy.validate 校验 role 类型，普通参考可含视频/音频）。
    if (type === "image" && resolved.some((a) => a.type !== "image")) {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE), "参考素材必须是图片", {
        code: ERROR_INVALID_REFERENCE_TYPE,
      });
    }
  }
  // IKFM3W §3 / IKFM41 §11：视频/音频文本带入素材存在性/归属/类型复核（图片路径经 merged
  // referenceAssetIds 天然覆盖；视频/音频单数组 asset 不走该通道，文本带入项在此同口径复核
  // ——身份声明 mediaType 与素材实际类型一致，保存与提交之间的素材替换不能绕过校验）。
  if (
    (type === "video" || type === "audio") &&
    textIndexRefs.value.index.refs.length > 0
  ) {
    const textProvided = textIndexRefs.value.index.refs;
    const ids = [...new Set(textProvided.map((item) => item.assetId))];
    const resolved = await deps.assets.resolveInputAssets(ids, userId, projectId);
    if (resolved.length !== ids.length) {
      // IKG6EK / ADR-0088：doc 退役后不再按 doc 声明细化缺失索引文案，统一走通用信封。
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), "参考素材不存在或无权访问", {
        code: ERROR_INVALID_REFERENCE,
      });
    }
    const resolvedTypes = new Map(ids.map((id, i) => [id, resolved[i]!.type]));
    if (textProvided.some((item) => resolvedTypes.get(item.assetId) !== item.mediaType)) {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE), "参考素材类型与声明不符", {
        code: ERROR_INVALID_REFERENCE_TYPE,
      });
    }
  }
  // IKG6EK / ADR-0088：视频/音频的 references 参考素材复核。原先这段只在携带 prompt_doc 时补齐，
  // doc 退役后无条件执行——三端统一 references，越权/缺失/类型不符一律在接纳当下 400。
  if (type === "video" || type === "audio") {
    const parsedTextRefs = parseReferences(effectiveBody.references);
    const textRefItems = parsedTextRefs.kind === "ok" ? parsedTextRefs.items : [];
    // references 单数组不走 reference_asset_ids 既有存在性复核，在此补齐：本地 asset 必须存在/有权，
    // 且声明 type 与素材实际类型一致（编号由 type 派生，谎报 type 会错编 图片N/视频N/音频N）。
    const localIds = textRefItems.filter((item) => item.asset_id !== undefined).map((item) => String(item.asset_id));
    if (localIds.length > 0) {
      const resolvedRefs = await deps.assets.resolveInputAssets(localIds, userId, projectId);
      if (resolvedRefs.length !== localIds.length) {
        return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), "参考素材不存在或无权访问", {
          code: ERROR_INVALID_REFERENCE,
        });
      }
      const resolvedTypes = new Map(localIds.map((id, i) => [id, resolvedRefs[i]!.type]));
      const mismatch = textRefItems.some(
        (item) => item.asset_id !== undefined && resolvedTypes.get(String(item.asset_id)) !== item.type,
      );
      if (mismatch) {
        return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE), "参考素材类型与声明不符", {
          code: ERROR_INVALID_REFERENCE_TYPE,
        });
      }
      // ⚠️ 输入视频的**时长**冻结进快照 —— 火山按 token 计价的公式在含视频输入时要把
      //    「输入时长」加进 token 估算（(输入时长 + 输出时长) × 宽 × 高 × 帧率 ÷ 1024），
      //    而时长是 references **元素上**的标量、数组本身进不了规格。所以在这里写进元素，
      //    由 billing 侧（billing-specs.ts 预扣 / SettlementUsageLines 结算）折算成标量键。
      //
      //    来源优先级：调用方带的 duration → 本地素材的 assets.duration（**权威**，
      //    由 resolveInputAssets 一并查出，省一次查询）。两者都没有就**不写这个字段**——
      //    宁可让 billing 判「含视频输入却量不到输入时长」而拒绝，也不按 0 估（少冻＝平台垫钱）。
      //    素材库引用（material_id，本地零表）只能靠调用方带；画布提交时会带。
      if (type === "video" && parsedTextRefs.kind === "ok") {
        const secondsByAssetId = new Map(
          localIds.map((id, i) => [id, resolvedRefs[i]!.duration]),
        );
        effectiveBody = {
          ...effectiveBody,
          references: withVideoReferenceDurations(textRefItems, secondsByAssetId),
        };
      }
    }
  }
  // IKIZQ8：样片提交确认（契约 §2，金标 G03/G04）——fail closed，位于建任务/预扣之前：
  // 变价（quote_revision 失效）、算不出价、缺确认字段都零创建、零扣费。
  //
  // 复算走**报价入口同一套**：projectQuoteInput（effectiveBody，与 handleQuoteGenerationJob
  // 同参——IKJGE6 起报价端点也做文本带入合并，两处必须同一份判定输入）+ applyEditSourceDurationBasis
  // （同一改写，编辑单按源时长复算）+ deps.quote（同一 createBillingQuote 装配）+ quoteRevisionOf
  // （同一指纹函数）。任何一处分叉，用户看到的报价与服务端核对的就会是两个数。
  // 位置在文本带入合并与时长回填**之后**：复算与冻结读同一次画布合并结果，不存在两次读画布
  // 之间的 TOCTOU；被合并/复核段先拒掉的请求（失效索引、素材缺失）本就到不了扣费。
  if (sampleRuling.kind === "sample") {
    const credits = body.expected_credits;
    const revision = body.quote_revision;
    if (
      typeof credits !== "number" || !Number.isInteger(credits) || credits <= 0 ||
      typeof revision !== "string" || revision === ""
    ) {
      return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "样片提交须携带 expected_credits 与 quote_revision", {
        code: ERROR_INVALID_INPUT,
      });
    }
    const quoteDep = deps.quote;
    if (quoteDep === undefined) {
      return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), "价格已更新，请刷新后重新确认提交", {
        code: ERROR_QUOTE_STALE,
      });
    }
    // 与报价入口同参（effectiveBody + 编辑口径改写，提示词同取原始 parameters.prompt——
    // 报价端点判定的就是这份；标记转移不改变意图判定，见 IKJFGQ 段注释）。
    const quoteInput = projectQuoteInput(type, effectiveBody, capability);
    if (quoteInput !== null) {
      applyEditSourceDurationBasis(
        quoteInput,
        isStr(params.prompt) ? params.prompt : "",
        capability?.features?.task_types,
      );
    }
    const ruleSnapshot = serializePricingRule(capability);
    const quote =
      quoteInput !== null
        ? await quoteDep({
            userId,
            modelId: resolvedModelId,
            taskType: type,
            input: quoteInput,
            ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
          })
        : null;
    const currentRevision =
      quote !== null && quoteInput !== null
        ? quoteRevisionOf({
            catalogVersion: quote.catalogVersion,
            capabilityVersion: capability?.version,
            tier: quote.tier,
            quoteInput,
          })
        : null;
    if (
      quote === null ||
      Number(quote.credits) !== credits ||
      currentRevision !== revision
    ) {
      return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), "价格已更新，请刷新后重新确认提交", {
        code: ERROR_QUOTE_STALE,
      });
    }
  }
  // IKG6EK / ADR-0088：`parameters.prompt` **一律权威**，doc 的正文编译与身份校验都不再需要。
  // 素材校验只保留一条——`references` 里的素材必须属于本用户（存在性/归属/类型复核见上方
  // IKE7JP 两段与 resolveTargetSnapshot），不越权即可。参考素材的标签派生统一由接纳管线的
  // 引用标记转移负责（backend/libs/core/transfer-reference-markers.ts）：身份不在集合里就不转、原样保留。
  {
    // 复用既有正文约束；后续附件组合也必须使用实际冻结的正文。
    const compiledError = strategy.validate({ ...effectiveBody, parameters: { ...params, prompt: promptText } });
    if (promptText.length > maxPromptLength) {
      return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "prompt 无效", {
        code: ERROR_INVALID_INPUT,
      });
    }
    if (compiledError) {
      return fail(errorCodeToNumeric(compiledError.code), compiledError.message, {
        code: compiledError.code,
      });
    }
  }
  // IKG6EK / ADR-0088：正文引用标记转移。提交方给的正文里素材引用写作 &<身份>&，
  // 此处按本次请求的素材顺序换成 @标签（编号现算）；后端对提示词只做这一件事——不拼装、不追加。
  // 身份形态由提交方决定、本层不解释：数字 = 本地 asset，asset- 前缀 = 素材库/虚拟角色库。
  // 标记里写哪种，取决于本次 references 里该素材是以哪种身份提交的——转成 material_id 再调上游
  // 是 worker 的事，不在接纳层。
  // 产出即最终正文，下游（方案快照、strategy.composeInput → input.prompt）一律消费它。
  // 注意：长度闸在转移之前量的是带 &id& 的原文，而转移可能**变长**（`&1&` 3 字 → `@图片1` 4 字），
  // 所以该闸不构成「最终正文不超限」的保证。实际不可达（正文由提交方给全，前端面板另有输入上限）；
  // 若要该不变式成立，需在转移之后复量一次。
  const markerItems = type === "image"
    ? referenceAssetIds.map((id) => ({ id: String(id), role: "reference" as const, type: "image" as const }))
    : videoRefItemsOf(effectiveBody.references);
  promptText = transferReferenceMarkers(promptText, buildReferenceMarkerLabels(markerItems));
  // 6. 画布目标快照（仅携带 target_node_id 时读画布；IKFM3S 复用文本索引派生的同次读取）
  const target = await resolveTargetSnapshot({
    ...(textIndexRefs.value.canvas ? { canvas: textIndexRefs.value.canvas } : {}),
    type,
    body: effectiveBody,
    referenceAssetIds: referenceAssetIds.map(String),
    promptText,
    projectId,
    deps,
    ...(textIndexRefs.value.index.refs.length > 0 || textIndexRefs.value.index.inputs.length > 0
      ? { textIndex: textIndexRefs.value.index }
      : {}),
  });
  if (!target.ok) {
    return fail(errorCodeToNumeric(target.value.code), target.value.message, {
      code: target.value.code,
    });
  }

  const parsedPlanRefs = parseReferences(effectiveBody.references);
  const planRefs = parsedPlanRefs.kind === "ok" ? parsedPlanRefs.items : [];
  const planSnapshot = (type === "image" || type === "video") && target.value.canvas && target.value.targetNodeId
    ? await freezePromptPlans({ ...target.value.canvas, targetId: target.value.targetNodeId,
        type, references: planRefs,
        inputIds: type === "video" ? planRefs.flatMap(r => r.asset_id ? [r.asset_id] : []) : referenceAssetIds.map(String), prompt: promptText, attachments: target.value.textAttachments,
        model: capability, userId, projectId, assets: deps.assets }) : undefined;

  // 7. 组装 job.input（策略按类型分派；IKFM3W：视频用合并后的 references 冻结）
  const input = strategy.composeInput({
    body: effectiveBody,
    params,
    resolvedModelId,
    promptText,
    targetNodeId: target.value.targetNodeId,
    textAttachments: target.value.textAttachments,
    referenceAssetIds,
    // IKG0LP：exactOptionalPropertyTypes 下不能显式传 undefined，按本仓惯例条件展开
    ...(capability ? { capability } : {}),
    ...(videoTaskType !== undefined ? { videoTaskType } : {}),
  });
  // 图片与视频一致：sk token 明文写进 job.input.provider_credential（修正四：凭证去密），处理时由 worker 直接取用。
  // 这样进程内即时调度与重启后的恢复扫描共用同一套凭据来源。
  if (internal.providerCredential) {
    input.provider_credential = internal.providerCredential;
  }
  input.expected_output_count = expectedOutputCount;
  // IKIZQ8：样片增量冻结进 input 快照（契约 §1）——Worker 读它走 Draft 提交、
  // 禁用供应商 URL 直存降级并计算转成片截止；重试/恢复消费同一份快照。
  if (sampleRuling.kind === "sample") {
    input.sample_mode = true;
  }
  // IKJ795：video_task_type 的冻结在 composeInput 内（与报价投影同源），此处不再补写。
  // IKJ797：编辑单预扣时长口径——按源参考视频最长时长冻结，堵「按 4 秒预扣、实际出十几秒」
  // 的透支。改写发生在快照落库之前：Java 结算 specsOf 读同一份快照 → 预扣与结算自动同口径；
  // worker 对编辑单的出站时长恒强制 -1、不读该字段。量不到源时长时不改写（详见函数注释）。
  applyEditSourceDurationBasis(
    input,
    typeof input.prompt === "string" ? input.prompt : "",
    capability?.features?.task_types,
  );
  // IKFM3S §4：文本输入签名冻结进快照——任务成功后前端轮询回写目标 usedInputSignature，
  // 重试随 input 原样复用；无文本输入（inputs 为空）不写，目标无文本边时提示本就不显示。
  if (textIndexRefs.value.index.inputs.length > 0) {
    input.text_input_signature = textInputSignatureOf(textIndexRefs.value.index.inputs);
  }
  if (planSnapshot) input.prompt_plan_snapshot = planSnapshot;

  // 8. actionIdentity 派生 + 事件类型
  //
  // ⚠️ 这里**必须**带 Date.now()，即同一把 Idempotency-Key 的两次提交本就得到不同的
  // actionIdentity。理由在 billing 那边：它拿它当预扣的幂等键（`hold:{commandId}`），而那条
  // 幂等记录是**永久**的、重放时按 job_id 找那笔预留（CreditService.hold）。若把它改成
  // 「同键恒定」，那么在「预扣成功但事务随后回滚（已被补偿退掉）」这条路径上，重试会带着
  // 同一把 commandId 去冻一笔新 job，billing 命中永久幂等记录却找不到新 job 的预留，
  // 直接抛 IllegalStateException —— 那把 key 从此**永久**提交不了。
  // 「同一个请求被重试不重复扣钱」这条保证落在**幂等表 + 补偿**上（见第 2 步与 billing 说明），
  // 不落在 commandId 的稳定性上。
  const actionSeed = `${projectId}\0${normalizedKey}\0${Date.now()}`;
  // 须 ≤ correlation_id VarChar(64);勿再加前缀(曾用 `bottom-dock:` 撑到 76 触发 Prisma P2000 → 生成任务 500)。
  // 来源由 event_type/aggregate_type 记录,前缀无代码消费。
  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const actionType =
    type === "video"
      ? "generate_video"
      : type === "audio"
        ? "generate_audio"
        : "generate_image";

  // IKF YHJ：素材校验状态门（ADR-0087）——视频生成采纳素材库引用前判定可用性。
  // 放在这里而不是策略校验里：此处 input 已冻结，新旧两套引用字段（references / 旧首尾帧字段）
  // 与本地 Asset 引用都在同一个对象上，一处覆盖全部路径；且尚未写入任何行，拒绝即零写入。
  if (deps.materialGate) {
    const reason = await deps.materialGate.assertInputUsable({
      userId,
      jobInput: input as unknown as Record<string, unknown>,
      jobType: type,
    });
    if (reason !== null) {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), reason, {
        code: ERROR_INVALID_REFERENCE,
      });
    }
  }

  // 9. 建任务（含预留点数）
  const cmdInput: CreateJobInput = {
    projectId,
    userId,
    type,
    expectedOutputCount,
    input,
    actionIdentity,
    actionType,
    // IKIZQ8：样片阶段落库（video_stage='sample' + charge_state='held'）。
    ...(sampleRuling.kind === "sample" ? { videoStage: "sample" as const } : {}),
  };
  // ★ 新计费：预扣 + 失败补偿一起交给 repo —— 它在**建 job 的事务内**（job 行插入后、
  //   提交前）调 hold，并在事务失败时调 release 把那笔冻结退掉（幂等键与等级的说明见
  //   GenerationDeps.billing）。两者都不进 cmdInput：那个对象是要落库的数据。
  // 序列化一次，给下面那个 hold 闭包用（`exactOptionalPropertyTypes` 下不能在展开里现算）。
  const ruleSnapshot = serializePricingRule(capability);
  const billingDep = deps.billing;
  const billing: JobBilling | undefined = billingDep
    ? {
        hold: (jobId) =>
          billingDep.hold({
            userId: String(userId),
            jobId,
            commandId: actionIdentity,
            modelId: resolvedModelId,
            taskType: type,
            input: input as unknown as Record<string, unknown>,
            // 计价规则随 Hold 送过去：它本质上是**模型的属性**（住在能力行的 pricing 列），
            // 而 billing 读不到 blue_whale（ADR-0114 不共享库）——由它的属主在 Hold 时一并送。
            // 未配（列还是 NULL）就不传，billing 侧回落到定价目录那份。
            ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
          }),
        release: (jobId, reason) =>
          billingDep.release({ userId: String(userId), jobId, reason }),
      }
    : undefined;
  const created = await deps.command.createJob(cmdInput, {
    ...(billing ? { billing } : {}),
    ...(idempotency ? { idempotency } : {}),
  });
  // 并发同键（两个请求同时过了第 2 步的快路径）：唯一索引只放一个事务进，我们这侧的事务
  // 连同那笔预扣已整体回滚（billing 补偿已把钱退掉），repo 回读到赢家那一行就交回这里。
  // 于是两个请求拿到**同一个** generation_job_id，只留一笔预扣。
  return createJobEnvelope(created);
}
