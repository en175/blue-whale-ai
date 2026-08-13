import { SetMetadata } from "@nestjs/common";

export const BYPASS_TRANSFORM_KEY = "bypassTransform";

/** 跳过全局 TransformInterceptor 统一包裹（用于 SSE 流、文件下载等非 JSON 响应）。 */
export const BypassTransform = (): MethodDecorator & ClassDecorator =>
  SetMetadata(BYPASS_TRANSFORM_KEY, true);
