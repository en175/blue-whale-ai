import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Res } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { CANVAS_SAVE_CONFLICT_CODES, CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import type { Response } from "express";
// IKJKUA：受控错误判定收敛到共享适配器；canvases 域按画布保存冲突白名单集合判定
// （IKJJQU B.8：code 即 HTTP 状态且 data.reason 为稳定字符串，信封直写状态码）。
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

  /** IKJJQU（B.5）：恢复页查询（分页游标）。受控错误按 code 透传 HTTP 状态。 */
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

  /** IKJJQU（B.5）：resolve 定向读取（只读，可重复）。 */
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
    // 必须绕开异常路径：AllExceptionsFilter 对所有异常一律投影 data:null，而冲突信封要带
    // data.version（前端据此刷新 If-Match）。不用 NewApiError.detail 走过滤器，是因为那个字段
    // 承载的是 new-api 上游原始响应体，把它投进响应 data 会把上游内部信息漏给客户端。
    // `save()` 现在只可能回「成功信封」「412」「422」或「428」四类（not-found 已改抛 DomainError；
    // 422 是空覆盖防护 IKIIWN，信封只带提示无 payload；428 是确认清空缺 If-Match IKIMQJ），
    // 下面这条 200 分支对任何非冲突信封生效，与改动前 `return result` + Nest 对 PUT 的
    // 默认 200 同语义——保留它是防御性的：将来 save() 若再长出 fail 信封，不至于静默回落。
    // 冲突码白名单收敛为 service 导出的单一权威源（CANVAS_SAVE_CONFLICT_CODES），
    // 新增冲突信封时在 service 侧登记，此处不维护第二份知识副本。
    if (CANVAS_SAVE_CONFLICT_CODES.has(result.code)) {
      res.status(result.code).json(result);
      return;
    }
    res.status(200).json(result);
  }
}
