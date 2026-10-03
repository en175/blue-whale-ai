// IKJJQW（B.8 局部适配器）：新协议受控错误判定——code 即 HTTP 状态且 data.reason 为稳定字符串。
// 这些信封必须由局部响应适配器直写状态码（AllExceptionsFilter 会置空 data）。
// IKJKUA：全仓唯一一份判定实现。原 generation-jobs / canvases / scene-card-generate /
// audio-mixes / audio-video-muxes 内的 5 份本地同款副本已收敛到此处；canvases 域传入
// CANVAS_SAVE_CONFLICT_CODES（画布保存冲突白名单，与默认集合语义独立演进、不合并）。
import type { Response } from "express";

import { RECOVERY_HTTP_STATUSES } from "@lib/contracts";

export function isRecoveryControlledEnvelope(
  result: { code: number; data: unknown },
  statuses: ReadonlySet<number> = RECOVERY_HTTP_STATUSES,
): boolean {
  return (
    statuses.has(result.code) &&
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
