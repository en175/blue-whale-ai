import { Body, Controller, Get, Headers, Param, Post, Put, Query, Res } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";

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
    // 必须绕开异常路径：AllExceptionsFilter 对所有异常一律投影 data:null，而冲突信封要带
    // data.version（前端据此刷新 If-Match）。不用 NewApiError.detail 走过滤器，是因为那个字段
    // 承载的是 new-api 上游原始响应体，把它投进响应 data 会把上游内部信息漏给客户端。
    // `save()` 现在只可能回「成功信封」或「412」两类（not-found 已改抛 DomainError），
    // 下面这条 200 分支对任何非 412 信封生效，与改动前 `return result` + Nest 对 PUT 的
    // 默认 200 同语义——保留它是防御性的：将来 save() 若再长出 fail 信封，不至于静默回落。
    if (result.code === 412) {
      res.status(412).json(result);
      return;
    }
    res.status(200).json(result);
  }
}
