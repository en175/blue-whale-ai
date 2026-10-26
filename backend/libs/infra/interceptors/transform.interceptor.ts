import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ResultEnvelope } from "@lib/contracts";
import { SUCCESS_CODE } from "@lib/contracts";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { BYPASS_TRANSFORM_KEY } from "@lib/infra/decorators/bypass-transform.decorator.js";

function isEnvelope(value: unknown): value is ResultEnvelope<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "msg" in value &&
    "data" in value
  );
}

function isAdminEnvelope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ResultEnvelope<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ResultEnvelope<T> | T> {
    const bypass = this.reflector.getAllAndOverride<boolean>(
      BYPASS_TRANSFORM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (bypass) return next.handle();

    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) {
          return data;
        }
        if (isEnvelope(data) || isAdminEnvelope(data)) return data;
        return { code: SUCCESS_CODE, msg: null, data: (data ?? null) as T };
      }),
    );
  }
}
