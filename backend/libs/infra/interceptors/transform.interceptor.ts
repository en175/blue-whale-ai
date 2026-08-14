import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ResultEnvelope } from "@blue-whale/contracts";
import { SUCCESS_CODE } from "@blue-whale/contracts";
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

/** 管理端信封 { success, data } / { success: false, error }：透传不包裹。 */
function isAdminEnvelope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    typeof (value as { success: unknown }).success === "boolean"
  );
}

/** 统一响应信封：控制器返回裸数据时包成 { code: 200, msg: null, data }；
 *  已是 ok()/fail() 信封（含 code/msg/data）则透传；流/Buffer/@BypassTransform 透传不包裹。 */
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
