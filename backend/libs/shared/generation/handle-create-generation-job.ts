import { freezePromptPlans } from "./prompt-plan-snapshot.js";
import type { CanvasEdge } from "@lib/contracts";
import type { PromptTargetNode } from "../canvas/prompt-target.js";
import { createHash } from "node:crypto";

import {
  COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
  COMPOSED_VIDEO_PROMPT_MAX_LENGTH,
  COMPOSED_AUDIO_PROMPT_MAX_LENGTH,
  ERROR_INVALID_INPUT,
  ERROR_INVALID_REFERENCE,
  ERROR_INVALID_REFERENCE_TYPE,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  RESOURCE_NOT_FOUND_CODE,
  checkGenerationParamLimit,
  toGenerationParamCheckInput,
  compilePromptDoc,
  compileVideoPromptDoc,
  docHasTextRef,
  fail,
  ok,
  promptDocSchema,
  validatePromptDocRefs,
  validateVideoPromptDocRefs,
  type PromptDoc,
  type PromptDocRefFailure,
  type TextAttachmentSnapshot,
  previewSourceSchema,
} from "@lib/contracts";
import {
  composeTextAttachmentPrompt,
  composeTextAttachmentPromptIndexed,
  extractTextNodeText,
} from "@lib/core";
import {
  DEFAULT_MAX_REFERENCE_IMAGES,
  type CanvasRepo,
  type CreateJobInput,
  type GenerationCommandRepo,
  type ModelCapabilityRepo,
  type ProjectRepo,
  type AssetOwnershipOps,
} from "@lib/shared/persistence/index.js";

import type { GenerationCostEstimator } from "./cost-estimator.js";
import { dimensionsFromSize, videoDimensions } from "@lib/shared/generation-runtime/index.js";
import {
  mapImageChannelRequest,
  parseStoredImageRequestMapping,
} from "./image-channel-parser.js";

const VIDEO_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "seedance-2": "doubao-seedance-2-0-260128",
};

export interface GenerationParameters {
  prompt?: unknown;
  aspect_ratio?: unknown;
  model_id?: unknown;
  size?: unknown;
  web_search?: unknown;
  sequential_image_generation?: unknown;
  resolution?: unknown;
  duration?: unknown;
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
  /** IKFA1M：正文素材标签结构（PromptDoc v1）。仅 type=image 允许携带；
   *  存在时以其编译结果替代 parameters.prompt 冻结进 input.prompt，原始结构冻结进 input.prompt_doc。 */
  prompt_doc?: unknown;
  parameters?: unknown;
  expected_output_count?: unknown;
}

/** IKDJNZ：单数组 references 元素（保序）。asset_id（本地）与 material_id（素材库）二选一。 */
export interface ReferenceItemInput {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  /** IKDJNZ：图片/视频参考 + 参考音频（role 仅 reference）。 */
  type: "image" | "video" | "audio";
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
    items.push({
      role,
      ...(aid !== null ? { asset_id: aid } : { material_id: mid as string }),
      type,
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

type GenerationType = "image" | "video" | "audio";

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
  // 全部有效文本（附件 + 提示词）为空的拒绝在 handler 读取画布快照后按 composeTextAttachmentPrompt 结果判定。
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
    if (
      !isStr(params.aspect_ratio) ||
      !/^[1-9][0-9]*:[1-9][0-9]*$/.test(params.aspect_ratio)
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

/** IKE4GC：音频生成参考素材——仅接受单数组 references（audio|image，role 强制 reference）。
 *  音频/图片生成无首尾帧概念；音频参考 ≤3、图片参考 ≤1、二者不可混用（seed-audio 官方限制）。
 *  旧参考字段（reference_asset_ids/input_asset_ids/reference_materials/首尾帧字段）对音频仍不支持，
 *  且与 references 互斥。 */
function validateAudioReferences(
  body: CreateGenerationJobBody,
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
  const audioCount = parsed.items.filter((r) => r.type === "audio").length;
  const imageCount = parsed.items.filter((r) => r.type === "image").length;
  if (audioCount > 3)
    return { code: ERROR_INVALID_REFERENCE, message: "参考音频最多 3 个" };
  if (imageCount > 1)
    return { code: ERROR_INVALID_REFERENCE, message: "参考图最多 1 个" };
  if (audioCount > 0 && imageCount > 0)
    return {
      code: ERROR_INVALID_REFERENCE,
      message: "音频与图片参考不可混用",
    };
  return null;
}

/** 素材库引用（MaterialReference）仅视频生成可用；非 video 一律拒绝。 */
function validateRejectMaterialReferences(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  if (
    body.first_frame_material_id !== undefined ||
    body.last_frame_material_id !== undefined ||
    body.reference_materials !== undefined
  ) {
    return {
      code: ERROR_UNSUPPORTED_INPUT,
      message: "素材库引用仅支持视频生成",
    };
  }
  return null;
}

/** 视频特有校验：首尾帧 / 普通参考 asset 互斥（≤12）+ 素材库引用（asset∨material 并集互斥/配对）。 */
function validateVideo(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  const inputAssetIds = Array.isArray(body.input_asset_ids)
    ? body.input_asset_ids
    : [];
  // IKA72G：image 参考图上限由 handler 读取模型能力配置（features.max_reference_images）后校验，
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
    // 普通参考数量上限沿用 Seedance 约束（首尾帧不计入；参考音频不占图/视频额度）。
    const refCount = parsed.items.filter(
      (r) => r.role === "reference" && r.type !== "audio",
    ).length;
    if (refCount > 12)
      return { code: ERROR_INVALID_REFERENCE, message: "参考素材最多 12 个" };
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
  // IKDJNZ：参考音频不占图/视频额度——12 上限只计图/视频并集；音频引用单独统计。
  const imageVideoRefCount = uniqueRefs.filter(
    (r) => r.type !== "audio",
  ).length;
  if (imageVideoRefCount > 12) {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材最多 12 个" };
  }
  return null;
}

// ---- 策略：按生成类型分派 validate + composeInput。
// 新增生成类型只需新增一个 strategy 并注册到 strategies，不再改动既有校验器（IKDZI1）。 ----

interface ComposeInputContext {
  body: CreateGenerationJobBody;
  params: GenerationParameters;
  resolvedModelId: string;
  promptText: string;
  targetNodeId: string | null;
  textAttachments: TextAttachmentSnapshot[];
  referenceAssetIds: Array<string | number>;
  /** IKFA1M：已通过结构与引用复核的正文素材标签（仅 image 携带）。 */
  promptDoc: PromptDoc | null;
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
      validateCommon(body, "image") ?? validateRejectMaterialReferences(body)
    );
  },
  composeInput({
    params,
    resolvedModelId,
    promptText,
    targetNodeId,
    textAttachments,
    referenceAssetIds,
    promptDoc,
  }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
    // 编译正文已通过接纳校验；同时冻结原始结构供审计与重试。
    if (promptDoc) {
      input.prompt_doc = promptDoc;
    }
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
    promptDoc,
  }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
    // IKFA1O：编译正文已通过接纳校验；同时冻结原始结构供审计与重试。
    if (promptDoc) {
      input.prompt_doc = promptDoc;
    }
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;
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
    return validateCommon(body, "audio") ?? validateAudioReferences(body);
  },
  composeInput({ body, resolvedModelId, promptText, targetNodeId, textAttachments, promptDoc }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      model_id: resolvedModelId,
    };
    if (promptDoc) input.prompt_doc = promptDoc;
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

// ---- pipeline 阶段 ----

function resolveModelId(type: GenerationType, modelId: unknown): string {
  // 白名单（IK6T90）：先解析视频模型名别名，再对解析后的最终 model_id 校验——
  // 别名不能绕过白名单。最终 id 必须命中启用且 capability_type 匹配的目录行，否则 400。
  return type === "video"
    ? String(VIDEO_MODEL_ALIASES[modelId as string] ?? modelId)
    : String(modelId);
}

/** 参考图字段语义统一（IKA72G）：image 参考图 = input_asset_ids（与前端契约/worker 对齐），
 *  video 普通参考素材 = reference_asset_ids；首尾帧走独立字段 first/last_frame_asset_id 不受此限。
 *  image 超限返回错误（含模型真实上限，回退常量 10）。 */
function resolveReferenceAssets(
  body: CreateGenerationJobBody,
  type: GenerationType,
  maxReferenceImages: number,
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
  if (type === "image" && referenceAssetIds.length > maxReferenceImages) {
    return {
      ok: false,
      value: {
        message: `参考图最多 ${maxReferenceImages} 张`,
        code: ERROR_UNSUPPORTED_INPUT,
        params: { max_reference_count: maxReferenceImages },
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

/** IKDLQF/IKDLQG/IKDMQT/IKFCXE：携带 target_node_id 时，接纳当下读取最新 Canvas 校验目标节点；
 *  文本附件推导覆盖图片/视频/音频（IKFCXE 解除音频限制），空 prompt 由组合校验拒绝。
 *  IKFA1P：正文含文本标签时组合按编号清单格式（长度校验跟随实际组合结果）。 */
async function resolveTargetSnapshot(args: {
  type: GenerationType;
  body: CreateGenerationJobBody;
  promptText: string;
  projectId: string;
  deps: Pick<GenerationDeps, "canvas">;
  /** 正文文本标签已复核的同次画布读取；编号与最终冻结不得读取不同版本。 */
  canvas?: Awaited<ReturnType<CanvasRepo["getByProject"]>>;
  /** ADR-0085：所选模型的 raw prompt 上限；组合闸取 max(契约预算, 模型值)。 */
  maxPromptLength: number;
  /** IKFA1P：含 text_ref 时文本附件按编号清单格式组合（与最终冻结的供应商正文一致）。 */
  promptDoc: PromptDoc | null;
}): Promise<
  | { ok: true; value: TargetSnapshot }
  | { ok: false; value: { message: string; code: string } }
> {
  const { type, body, promptText, projectId, deps, maxPromptLength, promptDoc } = args;
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
    // IKFCXE：主提示词为空时保持既有音频校验（不引入"仅附件生成"），
    // 附件正文不得单独充当音频输入；图片/视频仍允许非空白附件驱动。
    if (type === "audio" && promptText.trim() === "") {
      return {
        ok: false,
        value: { message: "prompt 无效", code: ERROR_INVALID_INPUT },
      };
    }
    // IKFA1P：正文含文本标签时按编号清单组合（建立 文本N ↔ 内容 关系），长度闸跟随实际格式。
    const composed = promptDoc && docHasTextRef(promptDoc)
      ? composeTextAttachmentPromptIndexed(textAttachments, promptText)
      : composeTextAttachmentPrompt(textAttachments, promptText);
    if (composed.trim() === "") {
      return {
        ok: false,
        value: { message: "prompt 无效", code: ERROR_INVALID_INPUT },
      };
    }
    // ADR-0085：模型 raw 上限可超过契约预算（image-2=32000），组合闸跟随取大，
    // 否则配了大上限的模型一挂文本附件就先撞组合闸，配置形同虚设。
    // IKFCXE：音频组合预算与图片/视频同值并列，取大逻辑一致。
    const composedMaxLength = Math.max(
      type === "video"
        ? COMPOSED_VIDEO_PROMPT_MAX_LENGTH
        : type === "audio"
          ? COMPOSED_AUDIO_PROMPT_MAX_LENGTH
          : COMPOSED_IMAGE_PROMPT_MAX_LENGTH,
      maxPromptLength,
    );
    if (composed.length > composedMaxLength) {
      return {
        ok: false,
        value: {
          message: `文本附件与提示词组合后超过 ${composedMaxLength} 字上限`,
          code: ERROR_INVALID_INPUT,
        },
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
  /** IK7G9X：成本估算器（可选）。提供时建预留写真实预估金额；缺省沿用旧行为（0 + dev）。 */
  costEstimator?: GenerationCostEstimator;
}

/** POST /api/projects/{projectId}/generation-jobs：创建生成任务（queued）+ 预留点数 + 日志。
 *  简化模型：无幂等表、单输出语义；action_identity 用 Idempotency-Key 派生（仅用于追溯）。
 *  IKDZI1：流水线化——项目校验 → 类型校验（策略分派）→ 模型白名单 → 参考图语义统一 →
 *  画布目标快照 → 组装 input（策略分派）→ 预留点数 → 建任务。 */
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

  // 2. 类型分派 + 校验
  const type = body.type as GenerationType;
  const strategy = strategies[type];
  if (!strategy)
    return fail(400, "暂不支持该生成类型", { code: ERROR_UNSUPPORTED_TYPE });
  // IKFA1M：结构/版本契约校验（未知版本不猜造）；引用关系复核在参考图复核之后进行。
  let promptDoc: PromptDoc | null = null;
  if (body.prompt_doc !== undefined) {
    const parsed = promptDocSchema.safeParse(body.prompt_doc);
    if (!parsed.success) {
      return fail(400, "prompt_doc 无效", { code: ERROR_INVALID_INPUT });
    }
    promptDoc = parsed.data;
  }
  const validateErr = strategy.validate(body);
  if (validateErr) return fail(400, validateErr.message, { code: validateErr.code });

  // 3. 模型白名单（别名解析 + 能力目录命中）
  const params = body.parameters as GenerationParameters;
  const expectedOutputCount = Number(body.expected_output_count);
  let promptText = isStr(params.prompt) ? params.prompt : "";
  const resolvedModelId = resolveModelId(type, params.model_id);
  const whitelist = await deps.models.listEnabledByType(type);
  if (!whitelist.some((m) => m.model_id === resolvedModelId)) {
    return fail(400, "model_id 不在可用模型白名单或已停用", {
      code: ERROR_MODEL_UNAVAILABLE,
    });
  }

  // 4. 参考图语义统一 + image 上限（IKA72G）
  const capability = whitelist.find((m) => m.model_id === resolvedModelId);
  const maxReferenceImages =
    capability?.features?.max_reference_images ?? DEFAULT_MAX_REFERENCE_IMAGES;
  // ADR-0085（IKESD6）：raw prompt 长度上限跟随模型目录（image-2 配 32000），
  // 缺省回落旧硬编码（image/video 4000 / audio 3000）；错误码与旧 validateCommon 一致。
  const maxPromptLength =
    capability?.features?.max_prompt_length ?? (type === "audio" ? 3000 : 4000);
  if (promptText.length > maxPromptLength)
    return fail(400, "prompt 无效", { code: ERROR_INVALID_INPUT });
  // IKE7JP：Dock 提交时前置校验 resolution/size/aspect_ratio/duration 对能力目录合法性——
  // 越界值在接纳当下 4xx 返回（capability_unsupported_* 细分码 + 可用值文案），不拖到 worker 执行期。
  // 仅视频校验时长；图片无时长。SceneCard 路径已有同源 checkCapabilityLimit（下一步迁移共享）。
  // 仅当请求明确携带尺寸/比例/时长时才校验（缺省由能力默认值兜底，见 checkCapabilityLimit 同源语义）；
  // 图片路径允许缺 size（能力行默认尺寸）。duration 单独存在也进入校验（review：防只带时长越界漏网）。
  if (
    capability &&
    type !== "audio" &&
    (params.size !== undefined ||
      params.resolution !== undefined ||
      (type === "video" && params.duration !== undefined))
  ) {
    const checked = toGenerationParamCheckInput({
      resolution: params.resolution,
      size: params.size,
      aspect_ratio: params.aspect_ratio,
      duration: type === "video" ? params.duration : undefined,
    });
    if (checked) {
      const limitErr = checkGenerationParamLimit(
        {
          supported_sizes: capability.supported_sizes,
          supported_aspect_ratios: capability.supported_aspect_ratios,
          supported_durations: capability.supported_durations,
        },
        checked,
      );
      if (limitErr) {
        return fail(400, limitErr.reason, {
          code: limitErr.code,
        });
      }
    }
  }
  // IKE7JP：图片 size×ratio 交叉格前置——GPT 交叉格未填 / banana 一维映射缺失的组合
  // 在接纳当下 400（invalid_reference_type，与 worker mapImageChannelRequest 同码同文案），不拖到执行期。
  if (type === "image" && capability) {
    const mapping = parseStoredImageRequestMapping(
      capability.channel_parser,
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
        return fail(400, "模型、分辨率与宽高比组合不受支持", {
          code: ERROR_INVALID_REFERENCE_TYPE,
        });
      }
    }
  }
  // IKE7JP：视频 resolution/aspect_ratio 组合必须能换算成像素（与 worker videoDimensions 同源），
  // 否则 worker 会在执行期才失败——越界在接纳当下 400（invalid_input），不拖到执行期。
  // 图片路径无此概念（走上方交叉格校验）。
  if (type === "video" && capability) {
    const resolution = isStr(params.resolution) ? params.resolution : "";
    const ratio = isStr(params.aspect_ratio) ? params.aspect_ratio : "";
    if (resolution && ratio) {
      const dimensions =
        videoDimensions(resolution, ratio) ?? dimensionsFromSize(resolution);
      if (!dimensions) {
        return fail(400, "视频分辨率与宽高比组合无效", {
          code: ERROR_INVALID_INPUT,
        });
      }
    }
  }
  const refs = resolveReferenceAssets(body, type, maxReferenceImages);
  if (!refs.ok) {
    return fail(400, refs.value.message, {
      code: refs.value.code,
      params: refs.value.params,
    });
  }
  // IKE7JP：提交时前置查参考素材存在性/类型——复用 worker resolveInputAssets（归属逻辑单份：
  // 项目直属 ∪ 全局 ∪ project_asset 关联）。缺失/无权访问在接纳当下 400，不拖到 worker 执行期。
  // 仅本地 Asset 引用需要查存在性；素材库引用（asset:// 载体）由上游强校验，格式已在前置校验。
  // code 与 worker 侧 resolveInputAssets 失败同源（review：参考不可用归 invalid_reference，
  // 类型不符归 invalid_reference_type，避免提交 gate 与 worker 兜底码漂移）。
  if (type !== "audio" && refs.value.referenceAssetIds.length > 0) {
    const ids = refs.value.referenceAssetIds.map(String);
    const resolved = await deps.assets.resolveInputAssets(ids, userId, projectId);
    if (resolved.length !== ids.length) {
      return fail(400, "参考素材不存在或无权访问", {
        code: ERROR_INVALID_REFERENCE,
      });
    }
    // 图片参考必须是图片（worker 同源校验）；视频参考允许图/视频（首尾帧必须图片已由
    // strategy.validate 校验 role 类型，普通参考可含视频/音频）。
    if (type === "image" && resolved.some((a) => a.type !== "image")) {
      return fail(400, "参考素材必须是图片", {
        code: ERROR_INVALID_REFERENCE_TYPE,
      });
    }
  }
  // IKFA1M/IKFA1O：正文素材标签服务端复核——失效标签阻止生成；标签身份必须在最终输入集合内
  // （该集合已过存在性/归属/类型复核），保存与提交之间的变化不能绕过校验。
  // 视频按提交的 references 实际结构编译（帧→角色名、普通参考→同类型编号），不信任客户端 label 缓存。
  let promptCanvas: Awaited<ReturnType<CanvasRepo["getByProject"]>> | undefined;
  if (promptDoc) {
    /** 标签复核失败 → 统一 400 响应（invalid_tag / unknown_asset / unknown_text 分支共用文案与错误码） */
    const failPromptDocRefs = (failure: PromptDocRefFailure | null) => {
      if (failure?.kind === "invalid_tag") {
        return fail(400, "存在已失效的素材标签，请删除后再提交", {
          code: ERROR_INVALID_REFERENCE,
        });
      }
      if (failure?.kind === "unknown_asset") {
        return fail(400, "正文素材标签指向无效的参考素材", {
          code: ERROR_INVALID_REFERENCE,
        });
      }
      if (failure?.kind === "unknown_text") {
        return fail(400, "正文文本标签指向无效的文本附件", {
          code: ERROR_INVALID_REFERENCE,
        });
      }
      return null;
    };
    let videoRefItems: Parameters<typeof validateVideoPromptDocRefs>[1] | null = null;
    if (type === "video" || type === "audio") {
      const parsed = parseReferences(body.references);
      const textOnlyDoc = (type === "audio" || docHasTextRef(promptDoc))
        && !promptDoc.segments.some((segment) => segment.kind === "asset_ref");
      if (parsed.kind !== "ok" && !(parsed.kind === "absent" && textOnlyDoc)) {
        return fail(400, `${type === "audio" ? "音频" : "视频"}正文素材标签请求必须携带单数组 references`, {
          code: ERROR_UNSUPPORTED_INPUT,
        });
      }
      const items = parsed.kind === "ok" ? parsed.items : [];
      videoRefItems = items.map((item) => ({
        id: String(item.asset_id ?? item.material_id),
        role: item.role,
        type: item.type,
      }));
      // IKFA1O：references 单数组不走 reference_asset_ids 既有存在性复核——
      // 携带标签时补齐（与生图路径同一 deps）：本地 asset 必须存在/有权，且声明 type
      // 与素材实际类型一致（编号由 type 派生，谎报 type 会错编 图片N/视频N/音频N）。
      const localIds = items.filter((item) => item.asset_id !== undefined).map((item) => String(item.asset_id));
      if (localIds.length > 0) {
        const resolvedRefs = await deps.assets.resolveInputAssets(localIds, userId, projectId);
        if (resolvedRefs.length !== localIds.length) {
          return fail(400, "参考素材不存在或无权访问", {
            code: ERROR_INVALID_REFERENCE,
          });
        }
        const resolvedTypes = new Map(localIds.map((id, i) => [id, resolvedRefs[i]!.type]));
        const mismatch = items.some(
          (item) => item.asset_id !== undefined && resolvedTypes.get(String(item.asset_id)) !== item.type,
        );
        if (mismatch) {
          return fail(400, "参考素材类型与声明不符", {
            code: ERROR_INVALID_REFERENCE_TYPE,
          });
        }
      }
    }
    // 图/视频共用文本身份复核；保留媒体存在性复核在前，复用同次画布读取冻结全文。
    let orderedTextNodeIds: string[] = [];
    if (docHasTextRef(promptDoc)) {
      const textTargetNodeId =
        isStr(body.target_node_id) && body.target_node_id.trim() !== ""
          ? body.target_node_id
          : null;
      if (textTargetNodeId === null) {
        return fail(400, "正文文本标签指向无效的文本附件", {
          code: ERROR_INVALID_REFERENCE,
        });
      }
      promptCanvas = await deps.canvas.getByProject(projectId);
      orderedTextNodeIds = textAttachmentsFromCanvas(
        JSON.parse(promptCanvas.nodes ?? "[]") as Array<{
          id?: unknown;
          type?: unknown;
          data?: Record<string, unknown>;
        }>,
        JSON.parse(promptCanvas.edges ?? "[]"),
        textTargetNodeId,
      ).map((attachment) => attachment.node_id);
    }
    if (videoRefItems !== null) {
      const refErr = failPromptDocRefs(validateVideoPromptDocRefs(promptDoc, videoRefItems, orderedTextNodeIds));
      if (refErr) return refErr;
      promptText = compileVideoPromptDoc(promptDoc, videoRefItems, orderedTextNodeIds.length > 0 ? orderedTextNodeIds : undefined);
    } else {
      const refErr = failPromptDocRefs(
        validatePromptDocRefs(promptDoc, refs.value.referenceAssetIds.map(String), orderedTextNodeIds),
      );
      if (refErr) return refErr;
      promptText = compilePromptDoc(promptDoc, refs.value.referenceAssetIds.map(String), orderedTextNodeIds.length > 0 ? orderedTextNodeIds : undefined);
    }
    // 复用既有正文约束；后续附件组合也必须使用实际冻结的正文。
    const compiledError = strategy.validate({ ...body, parameters: { ...params, prompt: promptText } });
    if (promptText.length > maxPromptLength) {
      return fail(400, "prompt 无效", { code: ERROR_INVALID_INPUT });
    }
    if (compiledError) {
      return fail(400, compiledError.message, { code: compiledError.code });
    }
  }
  // 5. 画布目标快照（仅携带 target_node_id 时读画布）
  const target = await resolveTargetSnapshot({
    ...(promptCanvas ? { canvas: promptCanvas } : {}),
    type,
    body,
    promptText,
    projectId,
    deps,
    maxPromptLength,
    promptDoc,
  });
  if (!target.ok) {
    return fail(400, target.value.message, { code: target.value.code });
  }

  const parsedPlanRefs = parseReferences(body.references);
  const planRefs = parsedPlanRefs.kind === "ok" ? parsedPlanRefs.items : [];
  const planSnapshot = (type === "image" || type === "video") && target.value.canvas && target.value.targetNodeId
    ? await freezePromptPlans({ ...target.value.canvas, targetId: target.value.targetNodeId,
        type, references: planRefs,
        inputIds: type === "video" ? planRefs.flatMap(r => r.asset_id ? [r.asset_id] : []) : assetIds(body.input_asset_ids), prompt: promptText, attachments: target.value.textAttachments,
        promptDoc, model: capability, userId, projectId, assets: deps.assets }) : undefined;

  // 6. 组装 job.input（策略按类型分派）
  const input = strategy.composeInput({
    body,
    params,
    resolvedModelId,
    promptText,
    targetNodeId: target.value.targetNodeId,
    textAttachments: target.value.textAttachments,
    referenceAssetIds: refs.value.referenceAssetIds,
    promptDoc,
  });
  // 图片与视频一致：sk token 明文写进 job.input.provider_credential（修正四：凭证去密），处理时由 worker 直接取用。
  // 这样进程内即时调度与重启后的恢复扫描共用同一套凭据来源。
  if (internal.providerCredential) {
    input.provider_credential = internal.providerCredential;
  }
  input.expected_output_count = expectedOutputCount;
  if (planSnapshot) input.prompt_plan_snapshot = planSnapshot;
  // IKFA1P：正文含文本标签且无方案快照时，把编号清单组合的最终供应商正文冻结进快照——
  // 编号清单格式只在接纳处实现一次，worker 按优先级直接消费（有方案快照时 providerPrompt 已含）。
  if (promptDoc && docHasTextRef(promptDoc) && !planSnapshot) {
    input.composed_prompt = composeTextAttachmentPromptIndexed(
      target.value.textAttachments,
      promptText,
    );
  }

  // 7. 幂等派生 actionIdentity + 事件类型
  const actionSeed = `${projectId}\0${idempotencyKey ?? ""}\0${Date.now()}`;
  // 须 ≤ correlation_id VarChar(64);勿再加前缀(曾用 `bottom-dock:` 撑到 76 触发 Prisma P2000 → 生成任务 500)。
  // 来源由 event_type/aggregate_type 记录,前缀无代码消费。
  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const actionType =
    type === "video"
      ? "generate_video"
      : type === "audio"
        ? "generate_audio"
        : "generate_image";

  // 8. 建任务（含预留点数）
  const cmdInput: CreateJobInput = {
    projectId,
    userId,
    type,
    expectedOutputCount,
    input,
    actionIdentity,
    actionType,
  };
  // IK7G9X：建预留时写真实预估金额（数量级口径；new-api 定价不可达 → 降级 0 + dev）。
  if (deps.costEstimator) {
    const snapshot = await deps.costEstimator({
      modelId: resolvedModelId,
      type,
      expectedOutputCount,
    });
    if (snapshot) {
      cmdInput.costReservation = snapshot;
    }
  }
  const created = await deps.command.createJob(cmdInput);
  return ok(created);
}
