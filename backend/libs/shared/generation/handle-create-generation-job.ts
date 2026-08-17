import { createHash } from "node:crypto";

import { fail, ok } from "@blue-whale/contracts";
import type {
  CreateJobInput,
  GenerationCommandRepo,
  ModelCapabilityRepo,
  ProjectRepo,
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
  parameters?: unknown;
  expected_output_count?: unknown;
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
  if (type !== "image" && type !== "video") return "暂不支持该生成类型";
  const params = body.parameters as GenerationParameters | undefined;
  if (
    !params ||
    !isStr(params.prompt) ||
    params.prompt.trim() === "" ||
    params.prompt.length > 4000
  ) {
    return "prompt 无效";
  }
  if (
    !isStr(params.aspect_ratio) ||
    !/^[1-9][0-9]*:[1-9][0-9]*$/.test(params.aspect_ratio)
  ) {
    return "aspect_ratio 无效";
  }
  if (!isStr(params.model_id) || params.model_id.trim() === "")
    return "model_id 无效";
  const count = Number(body.expected_output_count);
  if (!Number.isInteger(count) || count < 1 || count > 4)
    return "expected_output_count 须为 1-4";
  if (type === "video" && count !== 1) return "视频生成仅支持一个输出";
  const inputAssetIds = Array.isArray(body.input_asset_ids)
    ? body.input_asset_ids
    : [];
  if (type === "image" && inputAssetIds.length > 4) return "参考图最多 4 张";
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

  const type = body.type as "image" | "video";
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

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspect_ratio,
    model_id: resolvedModelId,
  };
  if (type === "image") {
    if (isStr(params.size)) input.size = params.size;
    input.web_search = params.web_search === true;
    input.sequential_image_generation =
      params.sequential_image_generation === true;
  } else {
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;
  }
  // 图片与视频一致：sk token 密封进 job.input.provider_credential，处理时由 worker 解出。
  // 这样进程内即时调度与重启后的恢复扫描共用同一套凭据来源。
  if (internal.providerCredential) {
    input.provider_credential = internal.providerCredential;
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
  if (firstFrameAssetId) input.first_frame_asset_id = firstFrameAssetId;
  if (lastFrameAssetId) input.last_frame_asset_id = lastFrameAssetId;
  if (referenceAssetIds.length > 0)
    input.reference_asset_ids = referenceAssetIds;
  input.expected_output_count = expectedOutputCount;

  const actionSeed = `${projectId}\0${idempotencyKey ?? ""}\0${Date.now()}`;
  // 须 ≤ correlation_id VarChar(64);勿再加前缀(曾用 `bottom-dock:` 撑到 76 触发 Prisma P2000 → 生成任务 500)。
  // 来源由 event_type/aggregate_type 记录,前缀无代码消费。
  const actionIdentity = createHash("sha256").update(actionSeed).digest("hex");
  const actionType = type === "video" ? "generate_video" : "generate_image";

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
