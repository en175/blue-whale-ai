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

export function writeRecoveryControlled(
  result: { code: number; msg: string | null; data: unknown },
  res?: Response,
): void {
  res?.status(result.code).json(result);
}
