import { z } from "zod";

export const CANVAS_RECOVERY_PROTOCOL_VERSION = 1 as const;

export const LOWERCASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const DECIMAL_ID = /^[1-9][0-9]*$/;

export const safeNonNegativeInt = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const finiteNumber = z.number().finite();
const positiveFiniteNumber = z.number().finite().positive();

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

export const RECOVERY_ITEM_STATES = ["pending", "present", "removed", "replaced", "transferred"] as const;
export type RecoveryItemState = (typeof RECOVERY_ITEM_STATES)[number];

export const RECOVERY_ACTIONS = ["apply", "remove", "restore", "replaceTarget", "settleTarget"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export function recoveryItemId(submissionId: string, outputKey: string): string {
  return `gcr:${submissionId}:${outputKey}`;
}

export function parseRecoveryItemId(itemId: string): { submissionId: string; outputKey: string } | null {
  const match = /^gcr:([0-9a-f-]{36}):(.+)$/.exec(itemId);
  return match ? { submissionId: match[1]!, outputKey: match[2]! } : null;
}

export const TARGET_OUTPUT_KEY = "$target";
export const PRIMARY_OUTPUT_KEY = "primary";

export const SAVE_CANVAS_RECOVERY_OPERATION = "SAVE_CANVAS_RECOVERY_V1";


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

export const RECOVERY_HTTP_STATUSES: ReadonlySet<number> = new Set([400, 404, 409, 412, 422, 428]);

export const recoveryChangeSchema = z.object({
  recoveryItemId: z.string().min(1).max(256),
  expectedRevision: safeNonNegativeInt,
  action: z.enum(RECOVERY_ACTIONS),
}).strict();

export type RecoveryChange = z.infer<typeof recoveryChangeSchema>;

export const recoverySaveFieldsSchema = z.object({
  recoveryProtocolVersion: z.literal(CANVAS_RECOVERY_PROTOCOL_VERSION),
  commandId: z.string().regex(LOWERCASE_UUID),
  recoveryChanges: z.array(recoveryChangeSchema),
}).strict();

export type RecoverySaveFields = z.infer<typeof recoverySaveFieldsSchema>;

export const RECOVERY_PAGE_LIMIT_MIN = 1;
export const RECOVERY_PAGE_LIMIT_MAX = 100;
export const RECOVERY_PAGE_LIMIT_DEFAULT = 50;
export const RECOVERY_RESOLVE_IDS_MAX = 100;

export const generationRecoveryMarkerSchema = z.object({
  protocolVersion: z.literal(CANVAS_RECOVERY_PROTOCOL_VERSION),
  submissionId: z.string().regex(LOWERCASE_UUID),
  outputKey: z.string().min(1).max(128),
}).strict();

export type GenerationRecoveryMarker = z.infer<typeof generationRecoveryMarkerSchema>;
