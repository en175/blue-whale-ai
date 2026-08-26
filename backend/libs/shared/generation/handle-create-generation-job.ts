import { createHash } from "node:crypto";

import { fail, ok } from "@blue-whale/contracts";
import {
  DEFAULT_MAX_REFERENCE_IMAGES,
  type CreateJobInput,
  type GenerationCommandRepo,
  type ModelCapabilityRepo,
  type ProjectRepo,
} from "@blue-whale/persistence";

import type { GenerationCostEstimator } from "./cost-estimator.js";

const RESOURCE_NOT_FOUND_CODE = 100301;
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
  parameters?: unknown;
  expected_output_count?: unknown;
}

/** 素材库引用（MaterialReference）：仅格式校验（Asset- 前缀），存在性/状态由上游强校验。 */
export interface MaterialReferenceInput {
  id: string;
  type: "image" | "video";
}

const MATERIAL_ID_PATTERN = /^Asset-.{1,128}$/;

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
    if (type !== "image" && type !== "video") return null;
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

function isStr(v: unknown): v is string {
  return typeof v === "string";
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

/** 校验请求体，返回错误信息或 null。对齐 Java CreateGenerationJobRequest 约束。 */
function validate(body: CreateGenerationJobBody): string | null {
  const type = body.type;
  if (type !== "image" && type !== "video" && type !== "audio")
    return "暂不支持该生成类型";
  const params = body.parameters as GenerationParameters | undefined;
  const maxPromptLength = type === "audio" ? 3000 : 4000;
  if (
    !params ||
    !isStr(params.prompt) ||
    params.prompt.trim() === "" ||
    params.prompt.length > maxPromptLength
  ) {
    return "prompt 无效";
  }
  if (type !== "audio") {
    if (
      !isStr(params.aspect_ratio) ||
      !/^[1-9][0-9]*:[1-9][0-9]*$/.test(params.aspect_ratio)
    ) {
      return "aspect_ratio 无效";
    }
  }
  if (!isStr(params.model_id) || params.model_id.trim() === "")
    return "model_id 无效";
  const count = Number(body.expected_output_count);
  if (!Number.isInteger(count) || count < 1 || count > 4)
    return "expected_output_count 须为 1-4";
  if ((type === "video" || type === "audio") && count !== 1)
    return "视频/音频生成仅支持一个输出";
  // IKA72G：音频一期不支持任何参考素材——reference_asset_ids 与 input_asset_ids 一并显式拒绝，
  // 避免统一字段语义后 input_asset_ids 被静默忽略。
  if (
    type === "audio" &&
    ((Array.isArray(body.reference_asset_ids) &&
      body.reference_asset_ids.length > 0) ||
      (Array.isArray(body.input_asset_ids) && body.input_asset_ids.length > 0))
  )
    return "音频生成一期不支持参考素材";
  const inputAssetIds = Array.isArray(body.input_asset_ids)
    ? body.input_asset_ids
    : [];
  // IKA72G：image 参考图上限由 handler 读取模型能力配置（features.max_reference_images）后校验，
  // 不再在此写死 4。
  if (type === "video") {
    const firstFrameAssetId = assetId(body.first_frame_asset_id);
    const lastFrameAssetId = assetId(body.last_frame_asset_id);
    const hasExplicitFrames =
      body.first_frame_asset_id !== undefined ||
      body.last_frame_asset_id !== undefined;
    const hasExplicitInputs =
      hasExplicitFrames || body.reference_asset_ids !== undefined;
    if (body.first_frame_asset_id !== undefined && firstFrameAssetId === null)
      return "首帧素材无效";
    if (body.last_frame_asset_id !== undefined && lastFrameAssetId === null)
      return "尾帧素材无效";
    if (lastFrameAssetId !== null && firstFrameAssetId === null)
      return "尾帧必须与首帧一起使用";
    if (
      body.reference_asset_ids !== undefined &&
      assetIds(body.reference_asset_ids).length !==
        (Array.isArray(body.reference_asset_ids)
          ? body.reference_asset_ids.length
          : -1)
    )
      return "参考素材无效";
    const explicitReferenceIds = uniqueAssetIds(
      assetIds(body.reference_asset_ids),
    );
    if (hasExplicitFrames && explicitReferenceIds.length > 0) {
      return "首尾帧模式不能与普通参考素材混用";
    }
    if (
      body.reference_asset_ids !== undefined &&
      explicitReferenceIds.length > 12
    ) {
      return "参考素材最多 12 个";
    }
    if (!hasExplicitInputs && inputAssetIds.length > 1)
      return "视频生成仅支持 0 或 1 个参考图";
  }
  // 素材库引用（MaterialReference）：仅视频生成可用；格式校验 + 与本地 Asset 引用按并集互斥/配对。
  if (type !== "video") {
    if (
      body.first_frame_material_id !== undefined ||
      body.last_frame_material_id !== undefined ||
      body.reference_materials !== undefined
    ) {
      return "素材库引用仅支持视频生成";
    }
  } else {
    const firstFrameAssetId2 = assetId(body.first_frame_asset_id);
    const lastFrameAssetId2 = assetId(body.last_frame_asset_id);
    const firstFrameMaterialId = materialId(body.first_frame_material_id);
    const lastFrameMaterialId = materialId(body.last_frame_material_id);
    if (
      body.first_frame_material_id !== undefined &&
      firstFrameMaterialId === null
    )
      return "首帧素材库引用无效";
    if (body.last_frame_material_id !== undefined && lastFrameMaterialId === null)
      return "尾帧素材库引用无效";
    if (firstFrameAssetId2 !== null && firstFrameMaterialId !== null)
      return "首帧只能指定一个来源";
    if (lastFrameAssetId2 !== null && lastFrameMaterialId !== null)
      return "尾帧只能指定一个来源";
    if (lastFrameMaterialId !== null && firstFrameMaterialId === null)
      return "尾帧必须与首帧一起使用";
    const refs = materialRefs(body.reference_materials);
    if (refs === null) return "参考素材库引用无效";
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
      return "首尾帧模式不能与普通参考素材混用";
    }
    if (body.reference_materials !== undefined && uniqueRefs.length > 12) {
      return "参考素材最多 12 个";
    }
  }
  return null;
}

/** POST /api/projects/{projectId}/generation-jobs：创建生成任务（queued）+ 预留点数 + 日志。
 *  简化模型：无幂等表、单输出语义；action_identity 用 Idempotency-Key 派生（仅用于追溯）。 */
export async function handleCreateGenerationJob(
  userId: string,
  projectId: string,
  body: CreateGenerationJobBody,
  idempotencyKey: string | null,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: GenerationCommandRepo;
    /** 能力目录白名单（启用 + 未软删，按 capability_type 过滤）。 */
    models: Pick<ModelCapabilityRepo, "listEnabledByType">;
    /** IK7G9X：成本估算器（可选）。提供时建预留写真实预估金额；缺省沿用旧行为（0 + dev）。 */
    costEstimator?: GenerationCostEstimator;
  },
  internal: { providerCredential?: string } = {},
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const err = validate(body);
  if (err) return fail(400, err);

  const type = body.type as "image" | "video" | "audio";
  const params = body.parameters as GenerationParameters;
  const expectedOutputCount = Number(body.expected_output_count);
  const inputAssetIds = (
    Array.isArray(body.input_asset_ids) ? body.input_asset_ids : []
  ) as number[];

  // 白名单（IK6T90）：先解析视频模型名别名，再对解析后的最终 model_id 校验——
  // 别名不能绕过白名单。最终 id 必须命中启用且 capability_type 匹配的目录行，否则 400。
  const resolvedModelId: string =
    type === "video"
      ? String(
          VIDEO_MODEL_ALIASES[params.model_id as string] ?? params.model_id,
        )
      : String(params.model_id);
  const whitelist = await deps.models.listEnabledByType(type);
  if (!whitelist.some((m) => m.model_id === resolvedModelId)) {
    return fail(400, "model_id 不在可用模型白名单或已停用");
  }

  // IKA72G：参考图上限读取模型能力配置（features.max_reference_images），与 worker/网关同一来源；
  // 能力行缺失时回退到与网关（maxImageEditImages）/ARK（Seedream 10 张复合编辑）一致的常量 10。
  const capability = whitelist.find((m) => m.model_id === resolvedModelId);
  const maxReferenceImages =
    capability?.features?.max_reference_images ?? DEFAULT_MAX_REFERENCE_IMAGES;

  // 参考图字段语义统一（IKA72G）：image 参考图 = input_asset_ids（与前端契约/worker 对齐），
  // video 普通参考素材 = reference_asset_ids；首尾帧走独立字段 first/last_frame_asset_id 不受此限。
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
    return fail(400, `参考图最多 ${maxReferenceImages} 张`);
  }

  let input: Record<string, unknown>;
  if (type === "audio") {
    input = { prompt: params.prompt, model_id: resolvedModelId };
  } else {
    input = {
      prompt: params.prompt,
      aspect_ratio: params.aspect_ratio,
      model_id: resolvedModelId,
    };
  }
  if (type === "image") {
    if (isStr(params.size)) input.size = params.size;
    input.web_search = params.web_search === true;
    input.sequential_image_generation =
      params.sequential_image_generation === true;
    // IKA72G：image 参考图统一落 input_asset_ids（worker 读取同字段）。
    if (referenceAssetIds.length > 0) input.input_asset_ids = referenceAssetIds;
  } else if (type === "video") {
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;
    if (firstFrameAssetId) input.first_frame_asset_id = firstFrameAssetId;
    if (lastFrameAssetId) input.last_frame_asset_id = lastFrameAssetId;
    if (referenceAssetIds.length > 0)
      input.reference_asset_ids = referenceAssetIds;
    // 素材库引用：冻结进 input 快照（仅 video）。零本地表，Worker 执行时转 asset:// 载体。
    const firstFrameMaterialId = materialId(body.first_frame_material_id);
    const lastFrameMaterialId = materialId(body.last_frame_material_id);
    const materialRefsResolved = uniqueMaterialRefs(
      materialRefs(body.reference_materials) ?? [],
    );
    if (firstFrameMaterialId) input.first_frame_material_id = firstFrameMaterialId;
    if (lastFrameMaterialId) input.last_frame_material_id = lastFrameMaterialId;
    if (materialRefsResolved.length > 0)
      input.reference_materials = materialRefsResolved;
  }
  // 图片与视频一致：sk token 密封进 job.input.provider_credential，处理时由 worker 解出。
  // 这样进程内即时调度与重启后的恢复扫描共用同一套凭据来源。
  if (internal.providerCredential) {
    input.provider_credential = internal.providerCredential;
  }
  input.expected_output_count = expectedOutputCount;

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
