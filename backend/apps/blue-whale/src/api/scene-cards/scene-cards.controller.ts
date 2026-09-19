import { createHash } from "node:crypto";
import { Controller, Delete, Get, Headers, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
  fail,
  ok,
} from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { SceneCardResourceService } from "@lib/shared/scene-card/scene-card.service.js";
import { wireInteger } from "@lib/shared/wire-integer.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

@Controller("scene-cards")
export class SceneCardsController {
  constructor(private readonly sceneCard: SceneCardResourceService) {}

  @Get(":sceneCardId")
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("sceneCardId") sceneCardId: string,
    @Res() res: Response,
  ) {
    if (!isDecimalId(sceneCardId)) {
      res.status(404).json(fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"));
      return;
    }
    const result = await this.sceneCard.getSceneCardResource(
      user.userId,
      sceneCardId,
    );
    if (result.kind !== "found") {
      res.status(404).json(fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"));
      return;
    }
    res.setHeader("ETag", `"${result.version}"`);
    res.status(200).json(
      ok({
        scene_card_id: wireInteger(result.scene_card_id),
        project_id: wireInteger(result.project_id),
        title: result.title,
        summary: result.summary,
        content_markdown: result.content_markdown,
        version: result.version,
      }),
    );
  }

  @Delete(":sceneCardId")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("sceneCardId") sceneCardId: string,
    @Res() res: Response,
    @Headers("if-match") ifMatch?: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (!isDecimalId(sceneCardId)) {
      res.status(404).json(fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"));
      return;
    }
    if (!idempotencyKey?.trim()) {
      res.status(400).json(fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key"));
      return;
    }
    if (!ifMatch) {
      res.status(428).json(fail(428, "缺少 If-Match"));
      return;
    }
    const etag = /^"([0-9]+)"$/.exec(ifMatch);
    if (!etag?.[1]) {
      res.status(412).json(fail(412, "If-Match 无效"));
      return;
    }
    const requestHash = createHash("sha256")
      .update(`DELETE:/api/scene-cards/${sceneCardId}:${ifMatch}`)
      .digest("hex");
    const result = await this.sceneCard.deleteSceneCardResource({
      userId: user.userId,
      sceneCardId,
      expectedVersion: Number(etag[1]),
      idempotencyKey,
      requestHash,
    });
    switch (result.kind) {
      case "deleted":
      case "replayed":
        res.status(204).send();
        return;
      case "not_found":
        res.status(404).json(fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在"));
        return;
      case "version_conflict":
        res
          .status(412)
          .json(
            fail(SCENE_CARD_VERSION_CONFLICT_CODE, "版本冲突，请刷新后重试", {
              current_scene_card_version: result.current_version,
            }),
          );
        return;
      case "idempotency_conflict":
        res
          .status(409)
          .json(
            fail(
              IDEMPOTENCY_KEY_REUSED_CODE,
              "Idempotency-Key 已被其他请求使用",
            ),
          );
        return;
    }
  }
}
