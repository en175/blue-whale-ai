import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { DomainError } from "@blue-whale/contracts";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import type { Request, Response } from "express";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/**
 * 全局异常 → `{ code, msg, data }` 信封；NewApiError/HttpException/DomainError 保留 HTTP 状态码。
 *
 * ADR-0083 把这里定为**唯一投影出入口**。之所以要唯一，是因为另一条路（在控制器里
 * `return fail(code, msg)`）压根不经过这里：那条路上没有人写 `response.status(...)`，
 * Nest 于是按方法给默认值，一次 POST 的拒绝回成 `HTTP 201` + 信封 `code: 400`——
 * 信封说失败，传输层说创建成功。只看状态码的客户端会把拒绝当成成功。
 *
 * 所以业务失败要 `throw new DomainError(...)`（或 `assetError(name)`），不要 return。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 领域错误：码、文案、HTTP 状态同出一张码表（contracts/error-codes.ts），这里只负责搬运。
    if (exception instanceof DomainError) {
      response
        .status(exception.status)
        .json({ code: exception.code, msg: exception.message, data: null });
      return;
    }

    if (exception instanceof NewApiError) {
      response
        .status(exception.status)
        .json({ code: exception.status, msg: exception.message, data: null });
      return;
    }

    if (exception instanceof AdminException) {
      response
        .status(exception.status)
        .json({ success: false, error: exception.message });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const raw =
        typeof body === "object" && body !== null && "message" in body
          ? (body as { message: unknown }).message
          : exception.message;
      const msg = Array.isArray(raw) ? raw.join(", ") : String(raw ?? exception.message);
      response.status(status).json({ code: status, msg, data: null });
      return;
    }

    logger.error(
      `${request.method} ${request.url} 未处理异常${
        exception instanceof Error ? `\n${exception.stack}` : `: ${String(exception)}`
      }`,
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: HttpStatus.INTERNAL_SERVER_ERROR, msg: "服务器内部错误", data: null });
  }
}
