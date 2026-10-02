// IKJJQU（IKIXK9-SPEC-20261002 B 节）：生成任务恢复契约 v1 的字段、身份与错误协议。
// 只放「跨端共享的形状与常量」；受理/保存的事务编排住在 persistence / canvas 服务层。
import { z } from "zod";

/** 恢复协议版本（v1 固定为 1）。 */
export const CANVAS_RECOVERY_PROTOCOL_VERSION = 1 as const;

/** 小写标准 UUID（submission_id / commandId / Idempotency-Key 承载一致性的基准形态）。 */
export const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 正整数十进制字符串（project_id / job_id / asset_id / slot_id 的对外形态）。 */
export const DECIMAL_ID = /^[1-9][0-9]*$/;

/** 非负安全整数。 */
export const safeNonNegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** 坐标：有限数。尺寸：正有限数。 */
const finiteNumber = z.number().finite();
const positiveFiniteNumber = z.number().finite().positive();

/** 恢复种子里的目标/来源快照（B.3）：发送时快照，名称与数量沿用画布现有限制。 */
const recoverySeedTargetSchema = z.object({
  role: z.enum(["draft", "existing-media", "result-placeholder"]),
  x: finiteNumber,
  y: finiteNumber,
  width: positiveFiniteNumber,
  height: positiveFiniteNumber,
  name: z.string(),
}).strict();

const recoverySeedSourceSchema = z.object({
  node_id: z.string().min(1).max(128),
  x: finiteNumber,
  y: finiteNumber,
  width: positiveFiniteNumber,
  height: positiveFiniteNumber,
  name: z.string(),
}).strict();

/** canvas_binding（B.3）：创建与通用重试携带；对象拒绝未知键。 */
export const canvasBindingSchema = z.object({
  protocol_version: z.literal(CANVAS_RECOVERY_PROTOCOL_VERSION),
  submission_id: z.string().regex(LOWERCASE_UUID),
  target_node_id: z.string().min(1).max(128),
  expected_binding_revision: safeNonNegativeInt,
  recovery_seed: z.object({
    target: recoverySeedTargetSchema,
    sources: z.array(recoverySeedSourceSchema),
  }).strict(),
}).strict();

export type CanvasBinding = z.infer<typeof canvasBindingSchema>;

/** 恢复项状态（B.4/B.6）。 */
export const RECOVERY_ITEM_STATES = ["pending", "present", "removed", "replaced", "transferred"] as const;
export type RecoveryItemState = (typeof RECOVERY_ITEM_STATES)[number];

/** 显式保存动作（B.6）。 */
export const RECOVERY_ACTIONS = ["apply", "remove", "restore", "replaceTarget", "settleTarget"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

/** 恢复项身份：gcr:<submission_id>:<output_key>（客户端视为不透明字符串）。 */
export function recoveryItemId(submissionId: string, outputKey: string): string {
  return `gcr:${submissionId}:${outputKey}`;
}

/** 目标项输出键（B.4）。 */
export const TARGET_OUTPUT_KEY = "$target";
/** 一对一产物输出键（B.4）。 */
export const PRIMARY_OUTPUT_KEY = "primary";

/** 新协议保存命令的幂等域（command_idempotency.operation）。 */
export const SAVE_CANVAS_RECOVERY_OPERATION = "SAVE_CANVAS_RECOVERY_V1";

// ── B.8 错误协议：HTTP 状态 = code，data.reason 为稳定值 ────────────────────────
// 受控错误经局部响应适配器返回（信封直写 HTTP 状态），不经 AllExceptionsFilter
// （它会置空 data，reason 不可读）。canvas 保存冲突码白名单见 canvas.service。

export const RECOVERY_REASONS = {
  invalidPayload: "invalid_recovery_payload",
  resourceNotFound: "recovery_resource_not_found",
  bindingConflict: "canvas_binding_conflict",
  itemConflict: "recovery_item_conflict",
  commandReused: "recovery_command_reused",
  versionConflict: "canvas_version_conflict",
  documentMismatch: "recovery_document_mismatch",
  versionRequired: "canvas_version_required",
  protocolRequired: "recovery_protocol_required",
  projectionInvalid: "recovery_projection_invalid",
} as const;

/** 新协议受控错误信封（code 即 HTTP 状态）。 */
export interface RecoveryErrorEnvelope {
  code: number;
  msg: string;
  data: {
    reason: string;
    [extra: string]: unknown;
  };
}

export function recoveryError(
  httpStatus: number,
  msg: string,
  reason: string,
  extra?: Record<string, unknown>,
): RecoveryErrorEnvelope {
  return { code: httpStatus, msg, data: { reason, ...extra } };
}

/** 受控错误的 HTTP 状态集合：create/retry/保存端点的局部适配器按此透传状态码。 */
export const RECOVERY_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 412, 422, 428]);

/** 显式恢复变更（B.6）。 */
export const recoveryChangeSchema = z.object({
  recoveryItemId: z.string().min(1).max(256),
  expectedRevision: safeNonNegativeInt,
  action: z.enum(RECOVERY_ACTIONS),
}).strict();

export type RecoveryChange = z.infer<typeof recoveryChangeSchema>;

/** 新协议保存请求的显式字段（B.6）：viewport/nodes/edges 由控制器透传，此处只校验恢复段。 */
export const recoverySaveFieldsSchema = z.object({
  recoveryProtocolVersion: z.literal(CANVAS_RECOVERY_PROTOCOL_VERSION),
  commandId: z.string().regex(LOWERCASE_UUID),
  recoveryChanges: z.array(recoveryChangeSchema),
}).strict();

export type RecoverySaveFields = z.infer<typeof recoverySaveFieldsSchema>;

/** 恢复页/resolve 请求限制（B.5）。 */
export const RECOVERY_PAGE_LIMIT_MIN = 1;
export const RECOVERY_PAGE_LIMIT_MAX = 100;
export const RECOVERY_PAGE_LIMIT_DEFAULT = 50;
export const RECOVERY_RESOLVE_IDS_MAX = 100;

/** 受保护节点在画布 data 上的标记（B.4）。 */
export const generationRecoveryMarkerSchema = z.object({
  protocolVersion: z.literal(CANVAS_RECOVERY_PROTOCOL_VERSION),
  submissionId: z.string().regex(LOWERCASE_UUID),
  outputKey: z.string().min(1).max(128),
}).strict();

export type GenerationRecoveryMarker = z.infer<typeof generationRecoveryMarkerSchema>;
