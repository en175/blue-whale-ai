import { createHash } from "node:crypto";

import { fail, ok } from "@blue-whale/contracts";
import type {
  CreateJobInput,
  GenerationCommandRepo,
  ProjectRepo,
} from "@blue-whale/persistence";

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
  parameters?: unknown;
  expected_output_count?: unknown;
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

/** 校验请求体，返回错误信息或 null。对齐 Java CreateGenerationJobRequest 约束。 */
function validate(body: CreateGenerationJobBody): string | null {
  const type = body.type;
  if (type !== "image" && type !== "video") return "暂不支持该生成类型";
  const params = body.parameters as GenerationParameters | undefined;
  if (!params || !isStr(params.prompt) || params.prompt.trim() === "" || params.prompt.length > 4000) {
    return "prompt 无效";
  }
  if (!isStr(params.aspect_ratio) || !/^[1-9][0-9]*:[1-9][0-9]*$/.test(params.aspect_ratio)) {
    return "aspect_ratio 无效";
  }
  if (!isStr(params.model_id) || params.model_id.trim() === "") return "model_id 无效";
  const count = Number(body.expected_output_count);
  if (!Number.isInteger(count) || count < 1 || count > 4) return "expected_output_count 须为 1-4";
  const inputAssetIds = Array.isArray(body.input_asset_ids) ? body.input_asset_ids : [];
  if (inputAssetIds.length > 4) return "参考图最多 4 张";
  if (type === "video" && inputAssetIds.length > 1) return "视频生成仅支持 0 或 1 个参考图";
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
  const inputAssetIds = (Array.isArray(body.input_asset_ids) ? body.input_asset_ids : []) as number[];

  const input: Record<string, unknown> = {
    prompt: params.prompt,
    aspect_ratio: params.aspect_ratio,
    model_id:
      type === "video"
        ? VIDEO_MODEL_ALIASES[params.model_id as string] ?? params.model_id
        : params.model_id,
  };
  if (type === "image") {
    if (isStr(params.size)) input.size = params.size;
    input.web_search = params.web_search === true;
    input.sequential_image_generation = params.sequential_image_generation === true;
  } else {
    if (isStr(params.resolution)) input.resolution = params.resolution;
    if (params.duration !== undefined) input.duration = params.duration;
    if (internal.providerCredential) {
      input.provider_credential = internal.providerCredential;
    }
  }
  if (inputAssetIds.length > 0) input.reference_asset_ids = inputAssetIds;
  input.expected_output_count = expectedOutputCount;

  const actionSeed = `${projectId}\0${idempotencyKey ?? ""}\0${Date.now()}`;
  const actionIdentity = `bottom-dock:${createHash("sha256").update(actionSeed).digest("hex")}`;
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
  const created = await deps.command.createJob(cmdInput);
  return ok(created);
}
