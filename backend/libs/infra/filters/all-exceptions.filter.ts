import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import type { Request, Response } from "express";

/** 全局异常 → { code, msg, data } 信封；NewApiError/HttpException 保留 HTTP 状态码。 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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

    this.logger.error(
      `${request.method} ${request.url} 未处理异常`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ code: HttpStatus.INTERNAL_SERVER_ERROR, msg: "服务器内部错误", data: null });
  }
}
