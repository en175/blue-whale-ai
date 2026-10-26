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

export async function handleStoryboardPreviewCreate(
  userId: string,
  projectId: string,
  sceneCardId: string,
  idempotencyKey: string | null,
  body: string,
  deps: StoryboardPreviewRepo,
  options?: {
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
    if (
      typeof jsonBody === "object" && jsonBody !== null
      && "canvas_binding" in jsonBody
    ) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "请求参数无效");
  }
  if (parsed.data.scene_card_id !== sceneCardId)
    return fail(errorCodeToNumeric(ERROR_INVALID_INPUT), "场景卡不一致");
  const canvasBinding: CanvasBinding | undefined = parsed.data.canvas_binding;
  if (canvasBinding && idempotencyKey.trim() !== canvasBinding.submission_id) {
    return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
      reason: RECOVERY_REASONS.invalidPayload,
    });
  }
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
      ...(options?.quotaCheck ? { quotaCheck: options.quotaCheck } : {}),
      ...(canvasRecovery ? { canvasRecovery } : {}),
    });
  } catch (error) {
    if (error instanceof RecoveryContractError) return error.envelope;
    throw error;
  }
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
