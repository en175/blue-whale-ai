import { createHash } from "node:crypto";

import {
  ERROR_INVALID_INPUT,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_UNSUPPORTED_INPUT,
  ERROR_UNSUPPORTED_TYPE,
  fail,
  ok,
} from "@blue-whale/contracts";
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
  /** IKDJNZ：视频参考素材单数组契约（保序）。元素 { role, asset_id?, material_id?, type }；
   *  存在时优先于旧的 reference_asset_ids/reference_materials/首尾帧字段。 */
  references?: unknown;
  parameters?: unknown;
  expected_output_count?: unknown;
}

/** IKDJNZ：单数组 references 元素（保序）。asset_id（本地）与 material_id（素材库）二选一。 */
export interface ReferenceItemInput {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  type: "image" | "video";
}

/** 素材库引用（MaterialReference）：仅格式校验（Asset- 前缀），存在性/状态由上游强校验。 */
export interface MaterialReferenceInput {
  id: string;
  type: "image" | "video";
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

/** IKDJNZ：解析单数组 references。未传返回 null（走旧字段路径），格式非法返回 []（整体拒绝）。 */
function parseReferences(v: unknown): ReferenceItemInput[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return [];
  const items: ReferenceItemInput[] = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) return [];
    const { role, asset_id, material_id, type } = item as Record<string, unknown>;
    if (role !== "first_frame" && role !== "last_frame" && role !== "reference")
      return [];
    if (type !== "image" && type !== "video") return [];
    // asset_id（本地，纯数字）与 material_id（素材库 asset-...）二选一。
    const aid = typeof asset_id === "string" ? assetId(asset_id) : null;
    const mid = typeof material_id === "string" ? materialId(material_id) : null;
    if (aid === null && mid === null) return [];
    if (aid !== null && mid !== null) return [];
    // 首尾帧必须是图片。
    if (role !== "reference" && type !== "image") return [];
    items.push({
      role,
      ...(aid !== null ? { asset_id: aid } : { material_id: mid as string }),
      type,
    });
  }
  return items;
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

/** 校验请求体，返回 { code, message } 或 null。对齐 Java CreateGenerationJobRequest 约束。
 *  IKBQEE / ADR-0078：创建期校验错误统一携带错误码（与执行期同源），前端 e.message 消费不变。 */
function validate(
  body: CreateGenerationJobBody,
): { code: string; message: string } | null {
  const type = body.type;
  if (type !== "image" && type !== "video" && type !== "audio")
    return { code: ERROR_UNSUPPORTED_TYPE, message: "暂不支持该生成类型" };
  const params = body.parameters as GenerationParameters | undefined;
  const maxPromptLength = type === "audio" ? 3000 : 4000;
  if (
    !params ||
    !isStr(params.prompt) ||
    params.prompt.trim() === "" ||
    params.prompt.length > maxPromptLength
  ) {
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
  // IKA72G：音频一期不支持任何参考素材——reference_asset_ids 与 input_asset_ids 一并显式拒绝，
  // 避免统一字段语义后 input_asset_ids 被静默忽略。
  if (
    type === "audio" &&
    ((Array.isArray(body.reference_asset_ids) &&
      body.reference_asset_ids.length > 0) ||
      (Array.isArray(body.input_asset_ids) && body.input_asset_ids.length > 0))
  )
    return {
      code: ERROR_UNSUPPORTED_INPUT,
      message: "音频生成一期不支持参考素材",
    };
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
      return { code: ERROR_INVALID_INPUT, message: "首帧素材无效" };
    if (body.last_frame_asset_id !== undefined && lastFrameAssetId === null)
      return { code: ERROR_INVALID_INPUT, message: "尾帧素材无效" };
    if (lastFrameAssetId !== null && firstFrameAssetId === null)
      return {
        code: ERROR_INVALID_INPUT,
        message: "尾帧必须与首帧一起使用",
      };
    if (
      body.reference_asset_ids !== undefined &&
      assetIds(body.reference_asset_ids).length !==
        (Array.isArray(body.reference_asset_ids)
          ? body.reference_asset_ids.length
          : -1)
    )
      return { code: ERROR_INVALID_INPUT, message: "参考素材无效" };
    const explicitReferenceIds = uniqueAssetIds(
      assetIds(body.reference_asset_ids),
    );
    if (hasExplicitFrames && explicitReferenceIds.length > 0) {
      return {
        code: ERROR_INVALID_INPUT,
        message: "首尾帧模式不能与普通参考素材混用",
      };
    }
    if (
      body.reference_asset_ids !== undefined &&
      explicitReferenceIds.length > 12
    ) {
      return { code: ERROR_INVALID_INPUT, message: "参考素材最多 12 个" };
    }
    if (!hasExplicitInputs && inputAssetIds.length > 1)
      return {
        code: ERROR_INVALID_INPUT,
        message: "视频生成仅支持 0 或 1 个参考图",
      };
  }
  // 素材库引用（MaterialReference）：仅视频生成可用；格式校验 + 与本地 Asset 引用按并集互斥/配对。
  if (type !== "video") {
    if (
      body.first_frame_material_id !== undefined ||
      body.last_frame_material_id !== undefined ||
      body.reference_materials !== undefined ||
      body.references !== undefined
    ) {
      return {
        code: ERROR_UNSUPPORTED_INPUT,
        message: "素材库引用仅支持视频生成",
      };
    }
  } else {
    // IKDJNZ：单数组 references 优先；存在时跳过旧字段校验路径。
    const parsedRefs = parseReferences(body.references);
    if (parsedRefs !== null && parsedRefs.length === 0) {
      return { code: ERROR_INVALID_INPUT, message: "参考素材引用无效" };
    }
    if (parsedRefs !== null) {
      const roleErr = validateReferenceRoles(parsedRefs);
      if (roleErr) return { code: ERROR_INVALID_INPUT, message: roleErr };
      // 普通参考数量上限沿用 Seedance 约束（首尾帧不计入）。
      const refCount = parsedRefs.filter((r) => r.role === "reference").length;
      if (refCount > 12)
        return { code: ERROR_INVALID_INPUT, message: "参考素材最多 12 个" };
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
      return { code: ERROR_INVALID_INPUT, message: "首帧素材库引用无效" };
    if (body.last_frame_material_id !== undefined && lastFrameMaterialId === null)
      return { code: ERROR_INVALID_INPUT, message: "尾帧素材库引用无效" };
    if (firstFrameAssetId2 !== null && firstFrameMaterialId !== null)
      return { code: ERROR_INVALID_INPUT, message: "首帧只能指定一个来源" };
    if (lastFrameAssetId2 !== null && lastFrameMaterialId !== null)
      return { code: ERROR_INVALID_INPUT, message: "尾帧只能指定一个来源" };
    if (lastFrameMaterialId !== null && firstFrameMaterialId === null)
      return { code: ERROR_INVALID_INPUT, message: "尾帧必须与首帧一起使用" };
    const refs = materialRefs(body.reference_materials);
    if (refs === null)
      return { code: ERROR_INVALID_INPUT, message: "参考素材库引用无效" };
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
    if (body.reference_materials !== undefined && uniqueRefs.length > 12) {
      return { code: ERROR_INVALID_INPUT, message: "参考素材最多 12 个" };
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
  if (err) return fail(400, err.message, { code: err.code });

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
    return fail(400, "model_id 不在可用模型白名单或已停用", {
      code: ERROR_MODEL_UNAVAILABLE,
    });
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
    return fail(400, `参考图最多 ${maxReferenceImages} 张`, {
      code: ERROR_UNSUPPORTED_INPUT,
      params: { max_reference_count: maxReferenceImages },
    });
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
    // IKDJNZ：单数组 references 冻结进 input 快照（保序），Worker 执行时按 role 拆帧/参考并做关联转换。
    const parsedRefs = parseReferences(body.references);
    if (parsedRefs !== null) {
      input.references = parsedRefs;
    } else {
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
