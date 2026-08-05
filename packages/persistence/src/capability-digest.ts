import { createHash } from "node:crypto";
import { canonicalizeJsonValue } from "@blue-whale/contracts";

/** 能力快照 digest：sha256(canonicalizeJsonValue(view))，row.version 无全局版本号时兜底。
 *  agent-run 冻结与 plan-application 复算共用本函数；两处算法漂移会导致能力检查误判。 */
export function capabilityDigest(view: Record<string, unknown>): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalizeJsonValue(view)))
    .digest("hex")}`;
}
