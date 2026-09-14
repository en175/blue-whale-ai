import { createHash } from "node:crypto";
import { canonicalizeJsonValue } from "@lib/contracts";

/** 能力快照 digest：sha256(canonicalizeJsonValue(view))，row.version 无全局版本号时兜底。
 *  agent-run 冻结与 plan-application 复算共用本函数；两处算法漂移会导致能力检查误判。 */
export function capabilityDigest(view: Record<string, unknown>): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalizeJsonValue(view)))
    .digest("hex")}`;
}

/** schema v1 的模型能力指纹输入。features 不在旧契约内，变更字段集须升级 schema。 */
export type ModelCapabilityDigestSource = {
  supported_sizes: unknown;
  supported_aspect_ratios: unknown;
  supported_durations: unknown;
  supported_formats: unknown;
  default_size: unknown;
  default_format: unknown;
  default_aspect_ratio: unknown;
  default_duration: unknown;
};

export function capabilityDigestFromModelCapability(
  source: ModelCapabilityDigestSource,
): string {
  return capabilityDigest({
    supported_sizes: source.supported_sizes,
    supported_aspect_ratios: source.supported_aspect_ratios,
    supported_durations: source.supported_durations,
    supported_formats: source.supported_formats,
    default_size: source.default_size,
    default_format: source.default_format,
    default_aspect_ratio: source.default_aspect_ratio,
    default_duration: source.default_duration,
  });
}
