import { wallClockRfc3339 } from "@lib/core";
import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  TARGET_OUTPUT_KEY,
  recoveryError,
  recoveryItemId,
  parseRecoveryItemId,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
} from "@lib/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import type { CreatedJob } from "./generation-command-repo.js";
import { projectVirtualOutputs } from "./canvas-recovery-multi-output.js";

export class RecoveryContractError extends Error {
  constructor(readonly envelope: RecoveryErrorEnvelope) {
    super(envelope.msg);
  }
}

export interface CanvasRecoveryAcceptance {
  projectId: string;
  userId: string;
  binding: CanvasBinding;
  operation: string;
  requestHash: string;
  idempotencyKey: string;
  taskType: string;
}

export interface CanvasRecoveryPlan {
  acceptance: CanvasRecoveryAcceptance;
  bindingRevision: number;
  previousTargetSnapshot: Record<string, unknown> | null;
  supersededSubmissionId: string | null;
}

const SNAPSHOT_ACTIVE_TASK_KEYS = new Set(["generationRecovery", "usedInputSignature", "usedInputJobId"]);

function stripActiveTaskFields(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SNAPSHOT_ACTIVE_TASK_KEYS.has(key)) stripped[key] = value;
  }
  return stripped;
}

function canvasNodeSnapshot(node: Record<string, unknown>): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    position: node.position ?? null,
    width: node.width ?? null,
    height: node.height ?? null,
    data: stripActiveTaskFields(node.data as Record<string, unknown> | undefined),
  };
}

async function lockProjectAndCanvas(tx: Prisma.TransactionClient, projectId: bigint) {
  await tx.$queryRaw`SELECT id FROM project WHERE id = ${projectId} FOR UPDATE`;
  const canvasRows = await tx.$queryRaw<
    Array<{ version: number; nodes_json: unknown }>
  >`SELECT version, nodes_json FROM canvas WHERE project_id = ${projectId} FOR UPDATE`;
  return canvasRows[0] ?? null;
}

export async function lockCanvasRecoveryForAcceptance(
  tx: Prisma.TransactionClient,
  acceptance: CanvasRecoveryAcceptance,
): Promise<
  | { kind: "replay"; result: CreatedJob }
  | { kind: "idempotency_conflict" }
  | { kind: "plan"; plan: CanvasRecoveryPlan }
> {
  const pid = BigInt(acceptance.projectId);
  const canvasRow = await lockProjectAndCanvas(tx, pid);
  const replayRow = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: pid,
        operation: acceptance.operation,
        idempotency_key: acceptance.idempotencyKey,
      },
    },
    select: { request_hash: true, generation_job_id: true, accepted_cursor: true },
  });
  if (replayRow) {
    if (replayRow.request_hash !== acceptance.requestHash) return { kind: "idempotency_conflict" };
    if (replayRow.generation_job_id === null) {
      throw new Error(`幂等行缺少 generation_job_id：project=${acceptance.projectId} operation=${acceptance.operation}`);
    }
    return {
      kind: "replay",
      result: {
        generation_job_id: replayRow.generation_job_id.toString(),
        cursor: Number(replayRow.accepted_cursor),
      },
    };
  }
  const ownerRows = await tx.$queryRaw<
    Array<{ generation_canvas_submission_id: bigint; output_key: string; binding_revision: number }>
  >`SELECT generation_canvas_submission_id, output_key, binding_revision
    FROM generation_canvas_node_owners WHERE project_id = ${pid} AND node_id = ${acceptance.binding.target_node_id} FOR UPDATE`;
  const owner = ownerRows[0];
  const currentRevision = owner ? Number(owner.binding_revision) : 0;
  if (currentRevision !== acceptance.binding.expected_binding_revision) {
    throw new RecoveryContractError(
      recoveryError(409, "目标节点承接版本已变化，请刷新后重试", RECOVERY_REASONS.bindingConflict, {
        currentBindingRevision: currentRevision,
      }),
    );
  }
  const nodes = Array.isArray(canvasRow?.nodes_json) ? (canvasRow!.nodes_json as Array<Record<string, unknown>>) : [];
  const targetNode = nodes.find(node => node.id === acceptance.binding.target_node_id) ?? null;
  const role = acceptance.binding.recovery_seed.target.role;
  if (role !== "result-placeholder") {
    if (!targetNode) {
      throw new RecoveryContractError(
        recoveryError(400, "恢复种子角色与画布事实不符", RECOVERY_REASONS.invalidPayload),
      );
    }
    if (role === "existing-media") {
      const assetId = (targetNode.data as Record<string, unknown> | undefined)?.assetId;
      if (typeof assetId !== "string" || assetId.length === 0) {
        throw new RecoveryContractError(
          recoveryError(400, "恢复种子角色与画布事实不符", RECOVERY_REASONS.invalidPayload),
        );
      }
    }
  }
  return {
    kind: "plan",
    plan: {
      acceptance,
      bindingRevision: currentRevision + 1,
      previousTargetSnapshot: targetNode ? canvasNodeSnapshot(targetNode) : null,
      supersededSubmissionId: null,
    },
  };
}

export async function verifyRetryCanvasRecoveryLink(
  tx: Prisma.TransactionClient,
  projectId: string,
  originalJobId: string,
  targetNodeId: string,
): Promise<RecoveryErrorEnvelope | null> {
  const priorSubmission = await tx.generation_canvas_submissions.findFirst({
    where: { project_id: BigInt(projectId), generation_job_id: BigInt(originalJobId) },
    orderBy: { id: "desc" },
  });
  if (priorSubmission && priorSubmission.target_node_id === targetNodeId) return null;
  return recoveryError(
    422, "原任务无可信恢复关联，不能迁移到新协议；请移除 canvas_binding 后重试",
    RECOVERY_REASONS.documentMismatch,
  );
}

export async function lockCanvasRecoveryForRetry(
  tx: Prisma.TransactionClient,
  acceptance: CanvasRecoveryAcceptance,
): Promise<
  | { kind: "replay"; result: CreatedJob }
  | { kind: "idempotency_conflict" }
  | { kind: "error"; envelope: RecoveryErrorEnvelope }
  | { kind: "plan"; plan: CanvasRecoveryPlan }
> {
  try {
    const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance);
    return locked;
  } catch (error) {
    if (error instanceof RecoveryContractError) return { kind: "error", envelope: error.envelope };
    throw error;
  }
}

export async function writeCanvasRecoveryRows(
  tx: Prisma.TransactionClient,
  plan: CanvasRecoveryPlan,
  jobId: bigint,
): Promise<void> {
  const { acceptance, bindingRevision } = plan;
  const pid = BigInt(acceptance.projectId);
  const ownerRows = await tx.$queryRaw<
    Array<{ generation_canvas_submission_id: bigint }>
  >`SELECT generation_canvas_submission_id FROM generation_canvas_node_owners
    WHERE project_id = ${pid} AND node_id = ${acceptance.binding.target_node_id} FOR UPDATE`;
  const previousOwnerId = ownerRows[0]?.generation_canvas_submission_id ?? null;
  const submission = await tx.generation_canvas_submissions.create({
    data: {
      project_id: pid,
      user_id: BigInt(acceptance.userId),
      protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
      submission_id: acceptance.binding.submission_id,
      operation: acceptance.operation,
      request_hash: acceptance.requestHash,
      generation_job_id: jobId,
      task_type: acceptance.taskType,
      target_node_id: acceptance.binding.target_node_id,
      binding_revision: bindingRevision,
      recovery_seed: acceptance.binding.recovery_seed as never,
      previous_target_snapshot: (plan.previousTargetSnapshot ?? undefined) as never,
      target_state: "pending",
      target_revision: 1,
    },
  });
  if (previousOwnerId !== null) {
    await tx.generation_canvas_submissions.update({
      where: { id: previousOwnerId },
      data: { target_state: "transferred", target_revision: { increment: 1 }, gmt_modified: new Date() },
    });
    await tx.generation_canvas_node_owners.update({
      where: { project_id_node_id: { project_id: pid, node_id: acceptance.binding.target_node_id } },
      data: {
        generation_canvas_submission_id: submission.id,
        output_key: TARGET_OUTPUT_KEY,
        binding_revision: bindingRevision,
        gmt_modified: new Date(),
      },
    });
  } else {
    await tx.generation_canvas_node_owners.create({
      data: {
        project_id: pid,
        node_id: acceptance.binding.target_node_id,
        generation_canvas_submission_id: submission.id,
        output_key: TARGET_OUTPUT_KEY,
        binding_revision: bindingRevision,
      },
    });
  }
}


interface RecoveryCursor {
  v: number;
  projectId: string;
  maxId: number;
  lastId: number;
}

export function encodeRecoveryCursor(cursor: RecoveryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeRecoveryCursor(encoded: string): RecoveryCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RecoveryCursor;
    if (
      typeof parsed !== "object" || parsed === null
      || parsed.v !== CANVAS_RECOVERY_PROTOCOL_VERSION
      || typeof parsed.projectId !== "string"
      || !Number.isInteger(parsed.maxId) || parsed.maxId <= 0
      || !Number.isInteger(parsed.lastId) || parsed.lastId < 0
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export interface RecoveryRecordView {
  submission_id: string;
  target_node_id: string;
  job_id: string;
  task_type: string;
  binding_revision: number;
  is_current: boolean;
  job: Record<string, unknown> | null;
  recovery_seed: CanvasBinding["recovery_seed"] | null;
  previous_target_snapshot: Record<string, unknown> | null;
  items: RecoveryItemView[];
}

export interface RecoveryItemView {
  recovery_item_id: string;
  output_key: string;
  node_id: string;
  state: "pending" | "present" | "replaced" | "removed" | "transferred";
  revision: number;
  node_binding_revision: number;
  asset_id: string | null;
  slot_id: string | null;
}

function jobDetailView(row: {
  id: bigint; type: string; status: string; progress: number;
  output_asset_ids: unknown; error: unknown; gmt_create: Date;
}): Record<string, unknown> {
  return {
    job_id: row.id.toString(),
    type: row.type,
    status: row.status,
    progress: row.progress,
    output_asset_ids: row.output_asset_ids ?? [],
    stored_error: row.error ?? null,
    created_at: wallClockRfc3339(row.gmt_create),
  };
}

async function computeVirtualOutputItems(
  tx: Prisma.TransactionClient,
  submission: { submission_id: string; target_node_id: string },
  job: { id: bigint; type: string; status: string; output_asset_ids: unknown; input: unknown } | null,
): Promise<Array<{ outputKey: string; nodeId: string; assetId: string | null; slotId: string | null }>> {
  const projection = await projectVirtualOutputs(tx, {
    submissionId: submission.submission_id,
    targetNodeId: submission.target_node_id,
    job,
  });
  if (projection.kind === "invalid") return [];
  return projection.items.map(item => ({
    outputKey: item.outputKey,
    nodeId: item.nodeId,
    assetId: item.assetId,
    slotId: item.slotId,
  }));
}

interface RecoveryRecordRow {
  id: bigint;
  submission_id: string;
  target_node_id: string;
  generation_job_id: bigint;
  task_type: string;
  binding_revision: number;
  recovery_seed: unknown;
  previous_target_snapshot: unknown;
  target_state: string;
  target_revision: number;
}

function ownerRevisionByNode(rows: Array<{ node_id: string; binding_revision: number }>): Map<string, number> {
  return new Map(rows.map(row => [row.node_id, Number(row.binding_revision)]));
}

async function toRecoveryRecord(
  tx: Prisma.TransactionClient,
  submission: RecoveryRecordRow,
  job: { id: bigint; type: string; status: string; output_asset_ids: unknown; input: unknown } | null,
  isCurrent: boolean,
  outputs: Array<{ output_key: string; node_id: string; asset_id: bigint | null; slot_id: bigint | null; state: string; revision: number }>,
  ownerRevisions: Map<string, number>,
): Promise<RecoveryRecordView> {
  const items: RecoveryItemView[] = [{
    recovery_item_id: recoveryItemId(submission.submission_id, TARGET_OUTPUT_KEY),
    output_key: TARGET_OUTPUT_KEY,
    node_id: submission.target_node_id,
    state: submission.target_state as RecoveryItemView["state"],
    revision: Number(submission.target_revision),
    node_binding_revision: ownerRevisions.get(submission.target_node_id) ?? 0,
    asset_id: null,
    slot_id: null,
  }];
  for (const output of outputs) {
    items.push({
      recovery_item_id: recoveryItemId(submission.submission_id, output.output_key),
      output_key: output.output_key,
      node_id: output.node_id,
      state: output.state as RecoveryItemView["state"],
      revision: Number(output.revision),
      node_binding_revision: ownerRevisions.get(output.node_id) ?? 0,
      asset_id: output.asset_id !== null ? output.asset_id.toString() : null,
      slot_id: output.slot_id !== null ? output.slot_id.toString() : null,
    });
  }
  if (outputs.length === 0) {
    for (const virtual of await computeVirtualOutputItems(tx, submission, job)) {
      items.push({
        recovery_item_id: recoveryItemId(submission.submission_id, virtual.outputKey),
        output_key: virtual.outputKey,
        node_id: virtual.nodeId,
        state: "pending",
        revision: 0,
        node_binding_revision: 0,
        asset_id: virtual.assetId,
        slot_id: virtual.slotId,
      });
    }
  }
  return {
    submission_id: submission.submission_id,
    target_node_id: submission.target_node_id,
    job_id: submission.generation_job_id.toString(),
    task_type: submission.task_type,
    binding_revision: Number(submission.binding_revision),
    is_current: isCurrent,
    job: isCurrent && job ? jobDetailView(job as never) : null,
    recovery_seed: (submission.recovery_seed ?? null) as CanvasBinding["recovery_seed"] | null,
    previous_target_snapshot: (submission.previous_target_snapshot ?? null) as Record<string, unknown> | null,
    items,
  };
}

export async function listCanvasRecoveryPage(
  prisma: PrismaClient,
  projectId: string,
  limit: number,
  cursor: { maxId: number; lastId: number } | null,
): Promise<{ records: RecoveryRecordView[]; nextCursor: string | null; canvasVersion: number | null }> {
  const pid = BigInt(projectId);
  return prisma.$transaction(async (tx) => {
    const canvasRows = await tx.canvas.findFirst({ where: { project_id: pid }, select: { version: true } });
    const maxId = cursor?.maxId ?? Number((await tx.generation_canvas_submissions.aggregate({
      where: { project_id: pid }, _max: { id: true },
    }))._max.id ?? 0n);
    const lastId = cursor?.lastId ?? 0;
    const rows = await tx.generation_canvas_submissions.findMany({
      where: { project_id: pid, id: { gt: lastId, lte: maxId } },
      orderBy: { id: "asc" },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    if (page.length === 0) return { records: [], nextCursor: null, canvasVersion: canvasRows?.version ?? null };
    const owners = await tx.generation_canvas_node_owners.findMany({ where: { project_id: pid } });
    const ownerByNode = new Map(owners.map(owner => [owner.node_id, owner]));
    const submissionIds = page.map(row => row.id);
    const outputs = await tx.generation_canvas_outputs.findMany({
      where: { generation_canvas_submission_id: { in: submissionIds } },
      orderBy: { id: "asc" },
    });
    const outputsBySubmission = new Map<bigint, typeof outputs>();
    for (const output of outputs) {
      const bucket = outputsBySubmission.get(output.generation_canvas_submission_id) ?? [];
      bucket.push(output);
      outputsBySubmission.set(output.generation_canvas_submission_id, bucket);
    }
    const jobIds = [...new Set(page.map(row => row.generation_job_id))];
    const jobs = await tx.generation_jobs.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, type: true, status: true, progress: true, output_asset_ids: true, error: true, gmt_create: true, input: true },
    });
    const jobsById = new Map(jobs.map(job => [job.id, job]));
    const ownerRevisions = ownerRevisionByNode(owners.map(o => ({ node_id: o.node_id, binding_revision: o.binding_revision })));
    const records: RecoveryRecordView[] = [];
    for (const submission of page) {
      const owner = ownerByNode.get(submission.target_node_id);
      const isCurrent = owner !== undefined
        && owner.generation_canvas_submission_id === submission.id
        && owner.output_key === TARGET_OUTPUT_KEY;
      const job = jobsById.get(submission.generation_job_id) ?? null;
      records.push(await toRecoveryRecord(
        tx, submission, job, isCurrent,
        outputsBySubmission.get(submission.id) ?? [],
        ownerRevisions,
      ));
    }
    const visible = records
      .filter(record => record.is_current || record.items.some(item => item.state !== "pending" && item.node_binding_revision > 0 && item.output_key !== TARGET_OUTPUT_KEY));
    const lastScanned = page[page.length - 1]!.id;
    const nextCursor = hasMore ? encodeRecoveryCursor({ v: CANVAS_RECOVERY_PROTOCOL_VERSION, projectId, maxId, lastId: Number(lastScanned) }) : null;
    return { records: visible, nextCursor, canvasVersion: canvasRows?.version ?? null };
  });
}

export async function resolveCanvasRecoveryItems(
  prisma: PrismaClient,
  projectId: string,
  itemIds: string[],
): Promise<RecoveryRecordView[]> {
  const pid = BigInt(projectId);
  return prisma.$transaction(async (tx) => {
    const submissionIds = new Set<string>();
    const wanted = new Set(itemIds);
    for (const itemId of itemIds) {
      const parsed = parseRecoveryItemId(itemId);
      if (!parsed) throw new RecoveryContractError(recoveryError(404, "恢复项不存在", RECOVERY_REASONS.resourceNotFound));
      submissionIds.add(parsed.submissionId);
    }
    const submissions = await tx.generation_canvas_submissions.findMany({
      where: { project_id: pid, submission_id: { in: [...submissionIds] } },
      orderBy: { id: "asc" },
    });
    if (submissions.length !== submissionIds.size) {
      throw new RecoveryContractError(recoveryError(404, "恢复项不存在", RECOVERY_REASONS.resourceNotFound));
    }
    const owners = await tx.generation_canvas_node_owners.findMany({ where: { project_id: pid } });
    const ownerByNode = new Map(owners.map(owner => [owner.node_id, owner]));
    const ids = submissions.map(row => row.id);
    const outputs = await tx.generation_canvas_outputs.findMany({
      where: { generation_canvas_submission_id: { in: ids } },
      orderBy: { id: "asc" },
    });
    const outputsBySubmission = new Map<bigint, typeof outputs>();
    for (const output of outputs) {
      const bucket = outputsBySubmission.get(output.generation_canvas_submission_id) ?? [];
      bucket.push(output);
      outputsBySubmission.set(output.generation_canvas_submission_id, bucket);
    }
    const jobIds = [...new Set(submissions.map(row => row.generation_job_id))];
    const jobs = await tx.generation_jobs.findMany({
      where: { id: { in: jobIds } },
      select: { id: true, type: true, status: true, progress: true, output_asset_ids: true, error: true, gmt_create: true, input: true },
    });
    const jobsById = new Map(jobs.map(job => [job.id, job]));
    const ownerRevisions = ownerRevisionByNode(owners.map(o => ({ node_id: o.node_id, binding_revision: o.binding_revision })));
    const resolved: RecoveryRecordView[] = [];
    for (const submission of submissions) {
      const owner = ownerByNode.get(submission.target_node_id);
      const isCurrent = owner !== undefined
        && owner.generation_canvas_submission_id === submission.id
        && owner.output_key === TARGET_OUTPUT_KEY;
      const record = await toRecoveryRecord(
        tx, submission, jobsById.get(submission.generation_job_id) ?? null, isCurrent,
        outputsBySubmission.get(submission.id) ?? [], ownerRevisions,
      );
      record.items = record.items.filter(item => wanted.has(item.recovery_item_id));
      resolved.push(record);
    }
    return resolved;
  });
}

export interface CanvasBindingView {
  protocol_version: number;
  submission_id: string;
  target_node_id: string;
  binding_revision: number;
  job_id: string;
  is_current: boolean;
}

export async function canvasBindingView(
  prisma: PrismaClient,
  projectId: string,
  submissionId: string,
): Promise<CanvasBindingView | null> {
  const submission = await prisma.generation_canvas_submissions.findUnique({
    where: { project_id_submission_id: { project_id: BigInt(projectId), submission_id: submissionId } },
  });
  if (!submission) return null;
  const owner = await prisma.generation_canvas_node_owners.findUnique({
    where: { project_id_node_id: { project_id: BigInt(projectId), node_id: submission.target_node_id } },
  });
  return {
    protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
    submission_id: submission.submission_id,
    target_node_id: submission.target_node_id,
    binding_revision: Number(submission.binding_revision),
    job_id: submission.generation_job_id.toString(),
    is_current: owner !== null
      && owner.generation_canvas_submission_id === submission.id
      && owner.output_key === TARGET_OUTPUT_KEY,
  };
}

export async function projectHasRecoverySubmissions(prisma: PrismaClient, projectId: string): Promise<boolean> {
  const row = await prisma.generation_canvas_submissions.findFirst({
    where: { project_id: BigInt(projectId) },
    select: { id: true },
  });
  return row !== null;
}

export async function projectCanvasNodeOwnerKeys(
  prisma: PrismaClient,
  projectId: string,
  nodeIds: readonly string[],
): Promise<Set<string>> {
  if (nodeIds.length === 0) return new Set();
  const owners = await prisma.generation_canvas_node_owners.findMany({
    where: { project_id: BigInt(projectId), node_id: { in: [...nodeIds] } },
    select: { node_id: true, generation_canvas_submission_id: true, output_key: true },
  });
  if (owners.length === 0) return new Set();
  const submissions = await prisma.generation_canvas_submissions.findMany({
    where: { id: { in: owners.map(owner => owner.generation_canvas_submission_id) } },
    select: { id: true, submission_id: true },
  });
  const submissionIdByRowId = new Map(submissions.map(row => [row.id.toString(), row.submission_id]));
  const keys = new Set<string>();
  for (const owner of owners) {
    const submissionId = submissionIdByRowId.get(owner.generation_canvas_submission_id.toString());
    if (submissionId !== undefined) keys.add(`${owner.node_id}:${submissionId}:${owner.output_key}`);
  }
  return keys;
}
