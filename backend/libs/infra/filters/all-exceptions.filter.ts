import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ApiError } from "@lib/core";
import { DomainError } from "@lib/contracts";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import type { Request, Response } from "express";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof DomainError) {
      response
        .status(exception.status)
        .json({ code: exception.code, msg: exception.message, data: null });
      return;
    }

    if (exception instanceof ApiError) {
      response.status(exception.status).json({
        code: exception.status,
        msg: exception.message,
        data: null,
        ...(typeof exception.code === "string" ? { error_code: exception.code } : {}),
      });
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
