import { createHash } from "node:crypto";
import {
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_INVALID_INPUT,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
  errorCodeToNumeric,
  fail,
  ok,
  storyboardPreviewCreateRequestSchema,
  type CanvasBinding,
} from "@lib/contracts";
import {
  RecoveryContractError,
  type CanvasRecoveryAcceptance,
  type StoryboardPreviewRepo,
} from "@lib/shared/persistence/index.js";

import { wireInteger } from "@lib/shared/wire-integer.js";

function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

/** StoryboardPreview 创建请求摘要（契约 §9 / CONTEXT L43-47）：方法 + 操作语义 + 资源路径 + body。
 *  同 CommandId 配同一摘要才重放，配不同摘要判冲突（100302）。
 *  IKJJR0：摘要吃**原始 body 字符串**，canvas_binding 天然覆盖（B.3 请求摘要覆盖完整 canvas_binding）。 */
export function storyboardPreviewRequestHash(
  projectId: string,
  sceneCardId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(
      `POST:scene_card.storyboard_preview:/projects/${projectId}/scene-cards/${sceneCardId}:${body}`,
    )
    .digest("hex");
}

/** 从 SceneCard 显式触发分镜预览（CONTEXT L43-47，可选旁路）。
 *  缺 Idempotency-Key → PARAM_MISSING；sceneCardId 非十进制 → 当作不存在；
 *  body 非 StoryboardPreviewCreateRequest → 400；能力漂移 → 100403；
 *  版本冲突 → 100406 附当前 SceneCard 版本；余额不足 → 100405。 */
export async function handleStoryboardPreviewCreate(
  userId: string,
  projectId: string,
  sceneCardId: string,
  idempotencyKey: string | null,
  body: string,
  deps: StoryboardPreviewRepo,
  options?: {
    providerCredential?: string;
    quotaCheck?: () => Promise<{ sufficient: boolean }>;
  },
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(sceneCardId)) {
    return fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在");
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(body);
  } catch {
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "请求参数无效");
  }
  const parsed = storyboardPreviewCreateRequestSchema.safeParse(jsonBody);
  if (!parsed.success) {
    // IKJJR0（B.8）：携带 canvas_binding 的非法载荷归新协议错误信封（reason 稳定值）。
    if (
      typeof jsonBody === "object" && jsonBody !== null
      && "canvas_binding" in jsonBody
    ) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "请求参数无效");
  }
  // URL 路径资源身份为权威，body 的 scene_card_id 必须与之相符。
  if (parsed.data.scene_card_id !== sceneCardId)
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "场景卡不一致");
  // IKJJR0（B.3）：canvas_binding 纯载荷校验——Idempotency-Key 必须等于 submission_id
  //   （请求结构与幂等承载一致性；摘要覆盖原始 body，天然含 canvas_binding）。
  const canvasBinding: CanvasBinding | undefined = parsed.data.canvas_binding;
  if (canvasBinding && idempotencyKey.trim() !== canvasBinding.submission_id) {
    return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
      reason: RECOVERY_REASONS.invalidPayload,
    });
  }
  // 图片 worker 必须持有明文凭证（修正四：去密）；缺失时在任何事务写入前拒绝，避免创建必然失败的预览与 Job。
  if (!options?.providerCredential) {
    return fail(PARAM_MISSING_CODE, "缺少生成凭证");
  }

  // IKJJR0：统一关联受理数据（operation 与幂等行同键；taskType 固定 image——
  // 分镜预览走图片通道，画格与视频通道物理隔离）。
  const requestHash = storyboardPreviewRequestHash(projectId, sceneCardId, body);
  const canvasRecovery: CanvasRecoveryAcceptance | undefined = canvasBinding
    ? {
        projectId,
        userId,
        binding: canvasBinding,
        operation: "scene_card.storyboard_preview",
        requestHash,
        idempotencyKey: canvasBinding.submission_id,
        taskType: "image",
      }
    : undefined;

  let result;
  try {
    result = await deps.createStoryboardPreview({
      userId,
      projectId,
      sceneCardId,
      idempotencyKey,
      requestHash,
      base_scene_card_version: parsed.data.base_scene_card_version,
      parameters: parsed.data.parameters,
      capability_snapshot_version: parsed.data.capability_snapshot_version,
      provider_credential: options.providerCredential,
      ...(options?.quotaCheck ? { quotaCheck: options.quotaCheck } : {}),
      ...(canvasRecovery ? { canvasRecovery } : {}),
    });
  } catch (error) {
    // B.8：新协议受控错误信封直写（code=HTTP 状态，data.reason 稳定值），不经全局过滤器。
    if (error instanceof RecoveryContractError) return error.envelope;
    throw error;
  }
  // IKJJR0：受理与重放同形——携带 canvas_binding 时成功 data 追加绑定视图
  //   （is_current 现查 owner 表，不将旧关联重新设为当前）。
  const bindingView = canvasBinding
    ? await deps.canvasBindingView(projectId, canvasBinding.submission_id)
    : null;
  switch (result.kind) {
    case "applied":
      return ok({
        preview_id: wireInteger(result.preview_id),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        cursor: wireInteger(result.cursor),
        ...(bindingView ? { canvas_binding: bindingView } : {}),
      });
    case "replayed":
      return ok({
        preview_id: wireInteger(result.preview_id),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        ...(bindingView ? { canvas_binding: bindingView } : {}),
      });
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "scene_card_not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在");
    case "version_conflict":
      return fail(SCENE_CARD_VERSION_CONFLICT_CODE, "版本冲突，请刷新后重试", {
        current_scene_card_version: result.current_scene_card_version,
      });
    case "capability_drift":
      return fail(
        PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        "生成能力已变化，需刷新能力后重试",
      );
    case "capability_limit":
      // 图片能力上限（count/size/aspect_ratio）归 capability_unsupported_param（1030），
      // reason 原文外显。
      return fail(
        errorCodeToNumeric(ERROR_CAPABILITY_UNSUPPORTED_PARAM),
        result.reason,
      );
    case "quota_insufficient":
      return fail(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE, "余额不足");
    case "forbidden":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
}
