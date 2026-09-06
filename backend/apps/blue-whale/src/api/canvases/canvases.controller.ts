import { Body, Controller, Get, Headers, Param, Post, Put, Query } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

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

  @Put(":projectId")
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Param("projectId") projectId: string,
    @Body() body: { viewport?: unknown; nodes?: unknown; edges?: unknown },
    @Headers("if-match") ifMatch?: string,
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
    if (result.code === 412) {
      throw new NewApiError("Canvas 版本冲突", 412);
    }
    return result;
  }
}
