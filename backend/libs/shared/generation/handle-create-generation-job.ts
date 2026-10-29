

import {
  localAssetReferenceIds,
  resolveReferenceDurations,
} from "./resolve-reference-durations.js";
import type { ReferenceItemInput } from "./reference-item-input.js";
import { freezePromptPlans } from "./prompt-plan-snapshot.js";
import { checkReferenceLimits } from "../generation-runtime/reference-limits.js";
import { validateReferenceImages } from "../generation-runtime/image-reference-validation.js";
import {
  freezeReferenceLimits,
  validateReferences,
} from "../generation-runtime/video-reference-validation.js";
import { VideoInputError } from "../generation-runtime/material-reference.js";
import type { CanvasEdge } from "@lib/contracts";
import {
  type PromptTargetNode,
} from "../canvas/prompt-target.js";
import { createHash } from "node:crypto";

import {
  resolvePromptMaxLength,
  IDEMPOTENCY_CONFLICT_CODE,
  RECOVERY_REASONS,
  canvasBindingSchema,
  type CanvasBinding,
  ERROR_INVALID_INPUT,
  ERROR_INVALID_REFERENCE,
  ASSET_UNAVAILABLE_CODE,
  ERROR_INVALID_REFERENCE_TYPE,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_QUOTE_STALE,
  ERROR_QUOTE_UNAVAILABLE,
  VIDEO_SAMPLE_RESOLUTION,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  messageOf,
  checkGenerationParamLimit,
  toGenerationParamCheckInput,
  canonicalSizeValue,
  resolveVideoMode,
  normalizeVideoMode,
  frozenVideoModeOf,
  modeAllowedRatios,
  FROZEN_VIDEO_MODE_KEY,
  ERROR_TASK_TYPE_PARAM_CONSTRAINT,
  TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
  hasModeConstraint,
  resolveOutputPixels,
  type VideoMode,
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
  RecoveryContractError,
  serializePricingRule,
  type CanvasRecoveryAcceptance,
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
import type { BillingCharge } from "@lib/shared/billing/billing-charge.js";
import type { BillingRelease } from "@lib/shared/billing/billing-release.js";
import type { BillingQuote } from "@lib/shared/billing/billing-quote.js";
import type { AssetProbe } from "@lib/shared/assets/ports.js";
import {
  countPromptCharacters,
  DURATION_BASIS_KEY,
  OMNI_TASK_TYPE_ALLOWED_KEY,
} from "@lib/shared/billing/billing-specs.js";
import { quoteRevisionOf, videoQuoteRevisionInput } from "./handle-quote-generation-job.js";

import {
  channelOf,
  mapImageChannelRequest,
  parseStoredChannel,
  parseStoredImageRequestMapping,
} from "./image-channel-parser.js";











export { serializePricingRule };

export interface GenerationParameters {
  prompt?: unknown;
  aspect_ratio?: unknown;
  model_id?: unknown;
  size?: unknown;
  web_search?: unknown;
  sequential_image_generation?: unknown;
  resolution?: unknown;
  duration?: unknown;

  generate_audio?: unknown;


  sample_mode?: unknown;
  mode?: unknown;
}

export interface CreateGenerationJobBody {
  type?: unknown;
  input_asset_ids?: unknown;
  first_frame_asset_id?: unknown;
  last_frame_asset_id?: unknown;
  reference_asset_ids?: unknown;

  first_frame_material_id?: unknown;
  last_frame_material_id?: unknown;

  reference_materials?: unknown;


  references?: unknown;

  target_node_id?: unknown;



  prompt_doc?: unknown;
  parameters?: unknown;
  expected_output_count?: unknown;



  expected_credits?: unknown;
  quote_revision?: unknown;



  canvas_binding?: unknown;
}


export interface MaterialReferenceInput {
  id: string;

  type: "image" | "video" | "audio";
}



const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

function materialId(v: unknown): string | null {
  return typeof v === "string" && MATERIAL_ID_PATTERN.test(v) ? v : null;
}


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





export function parseReferences(
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

    const aid = typeof asset_id === "string" ? assetId(asset_id) : null;
    const mid = typeof material_id === "string" ? materialId(material_id) : null;
    if (aid === null && mid === null) return { kind: "invalid" };
    if (aid !== null && mid !== null) return { kind: "invalid" };

    if (role !== "reference" && type !== "image") return { kind: "invalid" };

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


export type GenerationType = "image" | "video" | "audio";




function validateCommon(
  body: CreateGenerationJobBody,
  type: GenerationType,
): { code: string; message: string } | null {

  const hasTargetNode = body.target_node_id !== undefined;
  if (hasTargetNode) {
    if (!isStr(body.target_node_id) || body.target_node_id.trim() === "")
      return { code: ERROR_INVALID_INPUT, message: "target_node_id 无效" };
  }
  const params = body.parameters as GenerationParameters | undefined;




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




export { checkReferenceLimits };






function validateAudioReferences(
  body: CreateGenerationJobBody,
  features?: ModelFeatures,
): { code: string; message: string } | null {
  const parsed = parseReferences(body.references);
  if (parsed.kind === "invalid") {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
  }

  const hasLegacy =
    hasContent(body.reference_asset_ids) ||
    hasContent(body.input_asset_ids) ||
    hasContent(body.reference_materials) ||
    hasContent(body.first_frame_asset_id) ||
    hasContent(body.last_frame_asset_id) ||
    hasContent(body.first_frame_material_id) ||
    hasContent(body.last_frame_material_id);
  if (parsed.kind === "absent") {

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

    if (item.role !== "reference" || item.type === "video") {
      return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
    }

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




function validateImageSingleRefs(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  return parseReferences(body.references).kind === "invalid"
    ? { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" }
    : null;
}






function validateVideo(
  body: CreateGenerationJobBody,
  capability?: ModelCapabilityView,
): { code: string; message: string } | null {
  const features = capability?.features;
  const inputAssetIds = Array.isArray(body.input_asset_ids)
    ? body.input_asset_ids
    : [];
  const videoMode = normalizeVideoMode(
    (body.parameters as GenerationParameters | undefined)?.mode,
  );


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


  const parsed = parseReferences(body.references);
  if (parsed.kind === "invalid") {
    return { code: ERROR_INVALID_REFERENCE, message: "参考素材引用无效" };
  }
  if (parsed.kind === "ok") {

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







    if (features) {
      const limitErr = checkReferenceLimits(
        features,
        parsed.items
          .filter((r) => r.role === "reference")
          .map((r) => ({ type: r.type, duration: r.duration })),
        "video",
        videoMode,
      );
      if (limitErr) return { code: ERROR_INVALID_REFERENCE, message: limitErr };
    }












    if (features) {
      const hasFrame = parsed.items.some(
        (r) => r.role === "first_frame" || r.role === "last_frame",
      );
      const frameMode = hasFrame ? resolveVideoMode(parsed.items, "") : undefined;
      const allowedRatios = modeAllowedRatios(features.task_types, frameMode);
      if (allowedRatios) {



        const ratio = (body.parameters as GenerationParameters | undefined)?.aspect_ratio as string;
        if (!allowedRatios.includes(ratio)) {
          return {
            code: ERROR_INVALID_INPUT,
            message: `当前模式（${frameMode}）不支持 比例 ${ratio}，可用：${allowedRatios.join(" / ")}`,
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


  const videoRefCount = uniqueRefs.filter((r) => r.type === "video").length;
  const audioRefCount = uniqueRefs.filter((r) => r.type === "audio").length;
  if (features) {
    const limitErr = checkReferenceLimits(
      features,
      uniqueRefs.map((r) => ({ type: r.type })),
      "video",
      videoMode,
    );
    if (limitErr) return { code: ERROR_INVALID_REFERENCE, message: limitErr };
  }

  if (features && !features.audio_reference && audioRefCount > 0) {
    return { code: ERROR_INVALID_REFERENCE, message: "当前模型不支持音频素材参考" };
  }
  if (features && !features.video_reference && videoRefCount > 0) {
    return { code: ERROR_INVALID_REFERENCE, message: "当前模型不支持视频素材参考" };
  }
  return null;
}











export type SampleModeRuling =
  | { kind: "absent" }
  | { kind: "sample" }
  | { kind: "rejected"; code: string; message: string };

export function ruleSampleMode(args: {
  type: GenerationType;
  sampleMode: unknown;
  resolution: unknown;
  expectedOutputCount: number;

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



interface ComposeInputContext {
  body: CreateGenerationJobBody;
  params: GenerationParameters;
  resolvedModelId: string;
  promptText: string;
  targetNodeId: string | null;
  textAttachments: TextAttachmentSnapshot[];
  referenceAssetIds: Array<string | number>;

  capability?: ModelCapabilityView;


  videoMode?: VideoMode;
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
    capability,
    videoMode,
  }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;



    if (videoMode !== undefined) input[FROZEN_VIDEO_MODE_KEY] = videoMode;



    if (capability?.features?.audio === true) {
      input.generate_audio = params.generate_audio !== false;
    }
    if (capability?.features) {
      input[OMNI_TASK_TYPE_ALLOWED_KEY] =
        capability.features.omni_reference_task_type === true;
    }



    if (capability?.features) {
      input.reference_limits = freezeReferenceLimits(capability.features);
    }








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
  composeInput({ body, resolvedModelId, promptText, targetNodeId, textAttachments }) {
    const input: Record<string, unknown> = {
      prompt: promptText,
      model_id: resolvedModelId,
    };


    const parsed = parseReferences(body.references);
    if (parsed.kind === "ok") input.references = parsed.items;



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
























export function applyEditSourceDurationBasis(
  input: Record<string, unknown>,
  mode: VideoMode,
  taskTypes: unknown,
): boolean {
  if (!hasModeConstraint(taskTypes, "edit")) return false;

  const refs = Array.isArray(input.references)
    ? (input.references as ReadonlyArray<{
        role: string;
        type: string;
        duration?: unknown;
      }>)
    : [];
  if (mode !== "edit") return false;
  let maxSeconds: number | null = null;
  for (const ref of refs) {
    if (ref.type !== "video") continue;
    const seconds = ref.duration;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return false;
    }
    maxSeconds = Math.max(maxSeconds ?? 0, seconds);
  }
  if (maxSeconds === null) return false;
  input[DURATION_BASIS_KEY] = Math.round(maxSeconds);
  return true;
}





















export function projectQuoteInput(
  type: GenerationType,
  body: CreateGenerationJobBody,
  capability?: ModelCapabilityView,
  referenceAssetIdsOverride?: Array<string | number>,
): Record<string, unknown> | null {
  const strategy = strategies[type];
  const params = body.parameters as GenerationParameters | undefined;
  if (!strategy || typeof params !== "object" || params === null) return null;











  const imageReferenceMax =
    capability?.features?.image_reference_max ?? DEFAULT_IMAGE_REFERENCE_MAX;
  const referenceAssets =
    referenceAssetIdsOverride !== undefined
      ? { ok: true as const, value: { referenceAssetIds: referenceAssetIdsOverride } }
      : resolveReferenceAssets(body, type, imageReferenceMax);




  const quoteVideoMode =
    type === "video"
      ? normalizeVideoMode(params.mode) ??
        resolveVideoMode(
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
    ...(quoteVideoMode !== undefined ? { videoMode: quoteVideoMode } : {}),
  });
  if (typeof input.prompt === "string") {
    input.prompt_characters = String(countPromptCharacters(input.prompt));
  }
  delete input.prompt;

  input.expected_output_count = Number(body.expected_output_count);
  return input;
}














function resolveModelId(type: GenerationType, modelId: unknown): string {
  void type;
  return String(modelId);
}




export function resolveReferenceAssets(
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



  const singleRefs = type === "image" ? parseReferences(body.references) : { kind: "absent" as const };


  if (singleRefs.kind === "ok" && singleRefs.items.length > 0) {



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







export async function resolveTextIndexReferences(args: {
  type: GenerationType;
  body: CreateGenerationJobBody;
  projectId: string;
  deps: { canvas: Pick<CanvasRepo, "getByProject"> };
  directReferenceAssetIds: Array<string | number>;
  imageReferenceMax: number;

  capability?: ModelCapabilityView;
}): Promise<
  | {
      ok: true;
      value: {
        merged: Array<string | number>;
        index: TargetTextIndex;
        canvas: Awaited<ReturnType<CanvasRepo["getByProject"]>> | null;

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
  const videoMode = normalizeVideoMode(
    (args.body.parameters as GenerationParameters | undefined)?.mode,
  );

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
    const limitErr = videoReferenceLimitError(features, videoReferences, videoMode);
    if (limitErr) {
      return { ok: false, value: { message: limitErr, code: ERROR_INVALID_REFERENCE } };
    }
    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas, videoReferences } };
  }
  if (parsed.kind === "invalid") {

    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }
  const videoReferences = [
    ...parsed.items,
    ...textProvidedVideoReferences(parsed.items, index.refs),
  ];
  const mergedLimitErr = videoReferenceLimitError(
    features,
    videoReferences.filter((item) => item.role === "reference"),
    videoMode,
  );
  if (mergedLimitErr) {
    return { ok: false, value: { message: mergedLimitErr, code: ERROR_INVALID_REFERENCE } };
  }
  return {
    ok: true,
    value: { merged: args.directReferenceAssetIds, index, canvas, videoReferences },
  };
}







function videoReferenceLimitError(
  features: ModelFeatures | undefined,
  references: ReadonlyArray<ReferenceItemInput | TextProvidedVideoReference>,
  mode?: VideoMode | null,
): string | null {
  if (!features) return null;
  const items = references.map((item) => ({
    type: item.type,
    duration: "duration" in item && typeof item.duration === "number" ? item.duration : undefined,
  }));
  return checkReferenceLimits(features, items, "video", mode);
}






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

    return { ok: true, value: { merged: args.directReferenceAssetIds, index, canvas } };
  }

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




async function resolveTargetSnapshot(args: {
  type: GenerationType;
  body: CreateGenerationJobBody;
  promptText: string;
  projectId: string;
  deps: Pick<GenerationDeps, "canvas">;

  canvas?: Awaited<ReturnType<CanvasRepo["getByProject"]>>;

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


    textAttachments = textAttachmentsFromCanvas(
      nodes,
      JSON.parse(canvas.edges ?? "[]"),
      targetNodeId,
    );

    if (args.textIndex && args.textIndex.refs.length > 0) {
      const mediaByTextNode = textAttachmentMediaOf(args.textIndex);
      const parsed = parseReferences(body.references);
      const finalRefs = parsed.kind === "ok" ? parsed.items.map((item) => ({
        id: String(item.asset_id ?? item.material_id), role: item.role, type: item.type,
      })) : [];


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

        let text = typeof data?.text === "string" ? data.text : attachment.text;
        for (const mention of mentions) {
          if (!media.some((item) => item.node_id === mention.nodeId && item.asset_id === mention.assetId)) continue;
          const label = videoRefLabel(mention.assetId, type === "image" ? imageRefItems : finalRefs);
          if (label !== null) text = text.slice(0, mention.start) + label + text.slice(mention.end);
        }
        return { ...attachment, text, media };
      });
    }


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

  models: Pick<ModelCapabilityRepo, "listEnabledByType">;

  canvas: Pick<CanvasRepo, "getByProject">;

  assets: Pick<AssetOwnershipOps, "resolveInputAssets"> &
    Partial<Pick<AssetOwnershipOps, "findStorageKeys" | "saveMediaInfo">>;
  probe?: AssetProbe;

































  billing?: {
    charge: BillingCharge;
    release: BillingRelease;
  };




  quote?: BillingQuote;



  materialGate?: MaterialGate;
}


export interface MaterialGate {
  assertInputUsable(input: {
    userId: string;

    jobInput: Record<string, unknown>;

    jobType: string;
  }): Promise<string | null>;
}


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




export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;










export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)

      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}



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









function createJobEnvelope(
  result: CreateJobResult,
  bindingView?: {
    protocol_version: number;
    submission_id: string;
    target_node_id: string;
    binding_revision: number;
    job_id: string;
    is_current: boolean;
  } | null,
) {
  if ("kind" in result) return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  return ok(bindingView ? { ...result, canvas_binding: bindingView } : result);
}







export async function handleCreateGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  idempotencyKey: string | null,
  deps: GenerationDeps,
) {

  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");




  const normalizedKey = (idempotencyKey ?? "").trim();
  if (normalizedKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(PARAM_MISSING_CODE, `Idempotency-Key 过长（上限 ${IDEMPOTENCY_KEY_MAX_LENGTH} 字符）`);
  }
  let canvasBinding: CanvasBinding | null = null;
  if (body.canvas_binding !== undefined) {
    const parsedBinding = canvasBindingSchema.safeParse(body.canvas_binding);
    if (!parsedBinding.success) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    canvasBinding = parsedBinding.data;
    if (normalizedKey !== canvasBinding.submission_id) {
      return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
        reason: RECOVERY_REASONS.invalidPayload,
      });
    }
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
    if (replayed) return createJobEnvelope(replayed, canvasBinding ? await deps.command.canvasBindingView(projectId, canvasBinding.submission_id) : undefined);
  }



  const type = body.type as GenerationType;
  const strategy = strategies[type];
  if (!strategy)
    return fail(errorCodeToNumeric(ERROR_UNSUPPORTED_TYPE), "暂不支持该生成类型", {
      code: ERROR_UNSUPPORTED_TYPE,
    });


  const validateErr = strategy.validate(body);
  if (validateErr)
    return fail(errorCodeToNumeric(validateErr.code), validateErr.message, {
      code: validateErr.code,
    });


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




  const capability = whitelist.find((m) => m.model_id === resolvedModelId);

  if (capability) {
    const supportedSizes = Array.isArray(capability.supported_sizes)
      ? capability.supported_sizes
      : [];
    if (typeof params.resolution === "string") {
      params.resolution = canonicalSizeValue(params.resolution, supportedSizes);
    }
    if (typeof params.size === "string") {
      params.size = canonicalSizeValue(params.size, supportedSizes);
    }
  }



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



  const maxPromptLength = resolvePromptMaxLength(type, capability?.features?.max_prompt_length ?? null);
  if (promptText.length > maxPromptLength)
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "prompt 无效", {
      code: ERROR_INVALID_INPUT,
    });







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


  if (type === "image" && capability) {
    const mapping = parseStoredImageRequestMapping(
      channelOf(parseStoredChannel(capability.channel, "image")).parser,
      capability.request_mapping,
      { sizeId: capability.default_size, ratioId: capability.default_aspect_ratio },
    );
    if (mapping.parser !== "seedream") {


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




  const refs = resolveReferenceAssets(body, type, imageReferenceMax);
  if (!refs.ok) {
    return fail(errorCodeToNumeric(refs.value.code), refs.value.message, {
      code: refs.value.code,
      params: refs.value.params,
    });
  }



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





  let effectiveBody: CreateGenerationJobBody = textIndexRefs.value.videoReferences
    ? { ...body, references: textIndexRefs.value.videoReferences }
    : body;







  let videoMode: VideoMode | undefined;
  let videoRefItems: ReadonlyArray<{ role: string; type: string }> = [];
  if (type === "video") {
    const parsedRefs = parseReferences(effectiveBody.references);
    videoRefItems = parsedRefs.kind === "ok" ? parsedRefs.items : [];
    videoMode = normalizeVideoMode(params.mode) ?? resolveVideoMode(videoRefItems, promptText);
  }





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
        videoMode ? { ...checked, mode: videoMode } : checked,
      );
      if (limitErr) {
        return fail(errorCodeToNumeric(limitErr.code), limitErr.reason, {
          code: limitErr.code,
        });
      }
    }
  }





  if (capability && type === "video" && (videoMode === "edit" || videoMode === "extend")) {
    const allowed = modeAllowedRatios(capability.features?.task_types, videoMode);
    const ratio = isStr(params.aspect_ratio) ? params.aspect_ratio : "";
    if (allowed && !allowed.includes(ratio)) {
      return fail(
        errorCodeToNumeric(ERROR_TASK_TYPE_PARAM_CONSTRAINT),
        TASK_TYPE_PARAM_CONSTRAINT_MESSAGE,
        { code: ERROR_TASK_TYPE_PARAM_CONSTRAINT },
      );
    }
  }
  if (
    type === "video" &&
    (videoMode === "edit" || videoMode === "extend") &&
    !videoRefItems.some((item) => item.role === "reference" && item.type === "video")
  ) {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "视频编辑模式至少需要 1 段参考视频", {
      code: ERROR_INVALID_INPUT,
    });
  }






  let resolvedReferenceAssets: Awaited<
    ReturnType<typeof deps.assets.resolveInputAssets>
  > = [];

  if (type !== "audio" && referenceAssetIds.length > 0) {
    const ids = referenceAssetIds.map(String);
    const resolved = await deps.assets.resolveInputAssets(ids, userId, projectId);
    if (resolved.length !== ids.length) {

      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), "参考素材不存在或无权访问", {
        code: ERROR_INVALID_REFERENCE,
      });
    }
    resolvedReferenceAssets = resolved;


    if (type === "image" && resolved.some((a) => a.type !== "image")) {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE), "参考素材必须是图片", {
        code: ERROR_INVALID_REFERENCE_TYPE,
      });
    }

    if (type === "image") {
      const limitErr = validateReferenceImages(resolved, capability?.features ?? null);
      if (limitErr) {
        return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), limitErr.message, {
          code: ERROR_INVALID_REFERENCE,
          params: limitErr.params,
        });
      }
    }
  }



  if (
    (type === "video" || type === "audio") &&
    textIndexRefs.value.index.refs.length > 0
  ) {
    const textProvided = textIndexRefs.value.index.refs;
    const ids = [...new Set(textProvided.map((item) => item.assetId))];
    const resolved = await deps.assets.resolveInputAssets(ids, userId, projectId);
    if (resolved.length !== ids.length) {

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





  if (type === "video" || type === "audio") {
    const parsedTextRefs = parseReferences(effectiveBody.references);
    const textRefItems = parsedTextRefs.kind === "ok" ? parsedTextRefs.items : [];





    const hasLocalAssetRefs = localAssetReferenceIds(textRefItems).length > 0;
    const ruling = await resolveReferenceDurations({
      references: textRefItems,
      assetIdsOf: localAssetReferenceIds,
      userId,
      projectId,
      assets: deps.assets,
      ...(deps.probe ? { probe: deps.probe } : {}),
    });
    if (ruling.kind === "shortfall") {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), "参考素材不存在或无权访问", {
        code: ERROR_INVALID_REFERENCE,
      });
    }
    if (ruling.kind === "probe_failed") {
      return fail(
        ASSET_UNAVAILABLE_CODE,
        "参考素材时长读取失败，请稍后重试或更换素材",
        { code: "asset_unavailable" },
      );
    }
    if (type === "video" && capability?.features) {
      const limitErr = checkReferenceLimits(
        capability.features,
        ruling.references
          .filter((item) => item.role === "reference")
          .map((item) => ({ type: item.type, duration: item.duration })),
        "video",
        videoMode ?? null,
      );
      if (limitErr) {
        return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), limitErr, {
          code: ERROR_INVALID_REFERENCE,
        });
      }
    }


    const mismatch = textRefItems.some(
      (item) =>
        item.asset_id !== undefined &&
        ruling.assetsById.get(String(item.asset_id))?.type !== item.type,
    );
    if (mismatch) {
      return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE_TYPE), "参考素材类型与声明不符", {
        code: ERROR_INVALID_REFERENCE_TYPE,
      });
    }

    if (type === "video" && capability?.features) {
      const referenceItems = ruling.references.filter((item) => item.role === "reference");
      const probedDurations = new Map(
        referenceItems
          .filter((item) => item.asset_id !== undefined && item.duration !== undefined)
          .map((item) => [String(item.asset_id), item.duration!]),
      );
      const itemAssets = referenceItems
        .map((item) =>
          item.asset_id !== undefined
            ? ruling.assetsById.get(String(item.asset_id))
            : undefined,
        )
        .filter((asset): asset is NonNullable<typeof asset> => asset !== undefined)
        .map((asset) =>
          probedDurations.has(asset.id)
            ? { ...asset, duration: probedDurations.get(asset.id)! }
            : asset,
        );
      const parsedBodyRefs = parseReferences(body.references);
      const referencesProvided =
        parsedBodyRefs.kind === "ok" && parsedBodyRefs.items.length > 0;
      const legacyIds = referencesProvided
        ? []
        : uniqueAssetIds(referenceAssetIds.map(String)).filter(
            (id) => !ruling.assetsById.has(id),
          );
      const legacyAssets =
        legacyIds.length > 0
          ? resolvedReferenceAssets.filter((asset) => legacyIds.includes(asset.id))
          : [];
      const referenceAssets = [
        ...itemAssets,
        ...legacyAssets.filter((asset) => !itemAssets.some((item) => item.id === asset.id)),
      ];
      const materialReferences = uniqueMaterialRefs([
        ...referenceItems
          .filter((item) => item.material_id !== undefined)
          .map((item) => ({ id: item.material_id!, type: item.type })),
        ...(materialRefs(body.reference_materials) ?? []),
      ]);
      try {
        validateReferences(
          capability.features,
          referenceAssets,
          materialReferences,
          videoMode ?? null,
        );
      } catch (error) {
        const code = error instanceof VideoInputError ? error.code : ERROR_UNSUPPORTED_INPUT;
        return fail(
          errorCodeToNumeric(code),
          error instanceof Error ? error.message : "参考素材不受支持",
          { code },
        );
      }
    }










    if (type === "video" && hasLocalAssetRefs) {
      effectiveBody = { ...effectiveBody, references: ruling.references };
    }
  }









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
      return fail(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE), messageOf(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE)), {
        code: ERROR_QUOTE_UNAVAILABLE,
      });
    }


    const quoteInput = projectQuoteInput(type, effectiveBody, capability);
    if (quoteInput !== null) {
      applyEditSourceDurationBasis(
        quoteInput,
        frozenVideoModeOf(quoteInput),
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
            quoteInput: type === "video" ? videoQuoteRevisionInput(quoteInput) : quoteInput,
          })
        : null;
    if (quote === null) {
      return fail(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE), messageOf(errorCodeToNumeric(ERROR_QUOTE_UNAVAILABLE)), {
        code: ERROR_QUOTE_UNAVAILABLE,
      });
    }
    if (Number(quote.credits) !== credits || currentRevision !== revision) {
      return fail(errorCodeToNumeric(ERROR_QUOTE_STALE), messageOf(errorCodeToNumeric(ERROR_QUOTE_STALE)), {
        code: ERROR_QUOTE_STALE,
      });
    }
  }




  {

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









  const markerItems = type === "image"
    ? referenceAssetIds.map((id) => ({ id: String(id), role: "reference" as const, type: "image" as const }))
    : videoRefItemsOf(effectiveBody.references);
  promptText = transferReferenceMarkers(promptText, buildReferenceMarkerLabels(markerItems));

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


  const input = strategy.composeInput({
    body: effectiveBody,
    params,
    resolvedModelId,
    promptText,
    targetNodeId: target.value.targetNodeId,
    textAttachments: target.value.textAttachments,
    referenceAssetIds,

    ...(capability ? { capability } : {}),
    ...(videoMode !== undefined ? { videoMode } : {}),
  });
  input.expected_output_count = expectedOutputCount;


  if (sampleRuling.kind === "sample") {
    input.sample_mode = true;
  }




  applyEditSourceDurationBasis(
    input,
    videoMode ?? "text2video",
    capability?.features?.task_types,
  );


  if (textIndexRefs.value.index.inputs.length > 0) {
    input.text_input_signature = textInputSignatureOf(textIndexRefs.value.index.inputs);
  }
  if (planSnapshot) input.prompt_plan_snapshot = planSnapshot;











  const actionSeed = `${projectId}\0${normalizedKey}\0${Date.now()}`;


  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const actionType =
    type === "video"
      ? "generate_video"
      : type === "audio"
        ? "generate_audio"
        : "generate_image";




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


  const cmdInput: CreateJobInput = {
    projectId,
    userId,
    type,
    expectedOutputCount,
    input,
    actionIdentity,
    actionType,

    ...(sampleRuling.kind === "sample" ? { videoStage: "sample" as const } : {}),
  };




  const ruleSnapshot = serializePricingRule(capability);
  const billingDep = deps.billing;
  const billing: JobBilling | undefined = billingDep
    ? {
        charge: (jobId) =>
          billingDep.charge({
            userId: String(userId),
            jobId,
            commandId: actionIdentity,
            modelId: resolvedModelId,
            taskType: type,
            input: input as unknown as Record<string, unknown>,



            ...(ruleSnapshot !== undefined ? { ruleSnapshot } : {}),
          }),
        release: (jobId, reason) =>
          billingDep.release({ userId: String(userId), jobId, reason }),
      }
    : undefined;

  const canvasRecovery: CanvasRecoveryAcceptance | undefined = canvasBinding
    ? {
        projectId,
        userId,
        binding: canvasBinding,
        operation: CREATE_GENERATION_JOB_OPERATION,
        requestHash: idempotency!.requestHash,
        idempotencyKey: idempotency!.key,
        taskType: type,
      }
    : undefined;
  let created: CreateJobResult;
  try {
    created = await deps.command.createJob(
      { ...cmdInput, ...(canvasRecovery ? { canvasRecovery } : {}) },
      {
        ...(billing ? { billing } : {}),
        ...(idempotency ? { idempotency } : {}),
      },
    );
  } catch (error) {

    if (error instanceof RecoveryContractError) return error.envelope;
    throw error;
  }



  return createJobEnvelope(
    created,
    canvasBinding ? await deps.command.canvasBindingView(projectId, canvasBinding.submission_id) : undefined,
  );
}
