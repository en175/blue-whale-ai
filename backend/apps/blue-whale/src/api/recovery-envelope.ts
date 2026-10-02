// IKJJQW（B.8 局部适配器）：新协议受控错误判定——code 即 HTTP 状态且 data.reason 为稳定字符串。
// 这些信封必须由局部响应适配器直写状态码（AllExceptionsFilter 会置空 data）。
// 与 generation-jobs / canvases controller 内的 IKJJQU 同款判定同实现，供本票接入的
// 11 个媒体工具 controller 共用（QU 交付文件不动，本文件是新接入方的单一份额）。
import type { Response } from "express";

import { RECOVERY_HTTP_STATUSES } from "@lib/contracts";

export function isRecoveryControlledEnvelope(result: {
  code: number;
  data: unknown;
}): boolean {
  return (
    RECOVERY_HTTP_STATUSES.has(result.code) &&
    typeof result.data === "object" &&
    result.data !== null &&
    typeof (result.data as { reason?: unknown }).reason === "string"
  );
}

/** 受控错误直写（passthrough 模式下 res 可选；无 res 时返回原信封由框架处理）。 */
export function writeRecoveryControlled(
  result: { code: number; msg: string | null; data: unknown },
  res?: Response,
): void {
  res?.status(result.code).json(result);
}
