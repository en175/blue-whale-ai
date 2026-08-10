import { createHash } from "node:crypto";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { SceneCardResourceRepo } from "@blue-whale/persistence";

import { wireInteger } from "../wire-integer";
import { isDecimalId } from "./handle-agent-run-commands";

export async function handleGetSceneCardResource(
  userId: string,
  sceneCardId: string,
  deps: Pick<SceneCardResourceRepo, "getSceneCardResource">,
) {
  if (!isDecimalId(sceneCardId)) {
    return {
      status: 404,
      body: fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"),
    };
  }
  const result = await deps.getSceneCardResource(userId, sceneCardId);
  if (result.kind !== "found") {
    return {
      status: 404,
      body: fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"),
    };
  }
  return {
    status: 200,
    etag: `"${result.version}"`,
    body: ok({
      scene_card_id: wireInteger(result.scene_card_id),
      project_id: wireInteger(result.project_id),
      title: result.title,
      summary: result.summary,
      content_markdown: result.content_markdown,
      version: result.version,
    }),
  };
}

export async function handleDeleteSceneCardResource(
  userId: string,
  sceneCardId: string,
  ifMatch: string | null,
  idempotencyKey: string | null,
  deps: Pick<SceneCardResourceRepo, "deleteSceneCardResource">,
) {
  if (!isDecimalId(sceneCardId)) {
    return {
      status: 404,
      body: fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"),
    };
  }
  if (!idempotencyKey?.trim()) {
    return {
      status: 400,
      body: fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key"),
    };
  }
  if (!ifMatch) {
    return { status: 428, body: fail(428, "缺少 If-Match") };
  }
  const etag = /^"([0-9]+)"$/.exec(ifMatch);
  if (!etag?.[1]) {
    return { status: 412, body: fail(412, "If-Match 无效") };
  }
  const requestHash = createHash("sha256")
    .update(`DELETE:/api/scene-cards/${sceneCardId}:${ifMatch}`)
    .digest("hex");
  const result = await deps.deleteSceneCardResource({
    userId,
    sceneCardId,
    expectedVersion: Number(etag[1]),
    idempotencyKey,
    requestHash,
  });
  switch (result.kind) {
    case "deleted":
    case "replayed":
      return { status: 204 };
    case "not_found":
      return {
        status: 404,
        body: fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"),
      };
    case "version_conflict":
      return {
        status: 412,
        body: fail(SCENE_CARD_VERSION_CONFLICT_CODE, "版本冲突，请刷新后重试", {
          current_scene_card_version: result.current_version,
        }),
      };
    case "idempotency_conflict":
      return {
        status: 409,
        body: fail(
          IDEMPOTENCY_KEY_REUSED_CODE,
          "Idempotency-Key 已被其他请求使用",
        ),
      };
  }
}
