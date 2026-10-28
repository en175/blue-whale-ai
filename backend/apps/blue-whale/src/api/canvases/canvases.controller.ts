import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CANVAS_SAVE_CONFLICT_CODES, CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";
import { isRecoveryControlledEnvelope } from "../recovery-envelope.js";

@Controller("canvases")
export class CanvasesController {
  constructor(private readonly canvas: CanvasService) {}

  @Post(":projectId/prompt-previews/apply")
  applyPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.canvas.applyPreview(user.userId, projectId, body);
  }

  @Post(":projectId/conversation-quotes")
  createConversationQuote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.canvas.createConversationQuote(user.userId, projectId, body);
  }

  @Get(":projectId/conversation-quotes")
  listConversationQuotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Query("ids") ids?: string,
  ) {
    return this.canvas.listConversationQuotes(user.userId, projectId, ids ?? "");
  }

  @Get(":projectId/legacy-card-history")
  listLegacyCardHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
  ) {
    return this.canvas.listLegacyCardHistory(user.userId, projectId);
  }

  @Get()
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Query("projectId") projectId?: string,
  ) {
    return this.canvas.get(user.userId, projectId ?? "");
  }

  @Get(":projectId/generation-recovery")
  async listGenerationRecovery(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Res() res: Response,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    const result = await this.canvas.listGenerationRecovery(
      user.userId, projectId, limit ?? "", cursor ?? "",
    );
    if (isRecoveryControlledEnvelope(result, CANVAS_SAVE_CONFLICT_CODES)) {
      res.status(result.code).json(result);
      return;
    }
    res.status(200).json(result);
  }

  @Post(":projectId/generation-recovery/resolve")
  @HttpCode(200)
  async resolveGenerationRecovery(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const result = await this.canvas.resolveGenerationRecovery(user.userId, projectId, body);
    if (isRecoveryControlledEnvelope(result, CANVAS_SAVE_CONFLICT_CODES)) {
      res.status(result.code).json(result);
      return;
    }
    res.status(200).json(result);
  }

  @Post(":projectId/apply")
  @HttpCode(200)
  applyChanges(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.canvas.apply(user.userId, projectId, (body ?? {}) as {
      upsert_nodes?: unknown;
      delete_node_ids?: unknown;
      upsert_edges?: unknown;
      delete_edge_ids?: unknown;
      viewport?: unknown;
    });
  }

  @Put(":projectId")
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { viewport?: unknown; nodes?: unknown; edges?: unknown; confirmEmpty?: unknown; recoveryProtocolVersion?: unknown; commandId?: unknown; recoveryChanges?: unknown },
    @Headers("if-match") ifMatch: string | undefined,
    @Res() res: Response,
  ) {
    let expectedVersion: number | null | undefined;
    if (ifMatch === '"missing"') {
      expectedVersion = null;
    } else if (ifMatch !== undefined) {
      const match = /^"([0-9]+)"$/.exec(ifMatch);
      if (!match?.[1]) {
        throw new NewApiError("无效的 If-Match", 400);
      }
      expectedVersion = Number(match[1]);
    }
    const result = await this.canvas.save(user.userId, projectId, {
      ...body,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    if (CANVAS_SAVE_CONFLICT_CODES.has(result.code)) {
      res.status(result.code).json(result);
      return;
    }
    res.status(200).json(result);
  }
}
