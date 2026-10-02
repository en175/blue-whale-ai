/* ============================================
 * IKJJQU（IKIXK9-SPEC-20261002 B 节）：生成任务恢复契约 v1 的持久层。
 *
 * 三张表（见迁移 20261003000000_ikjjqu_canvas_recovery_v1）：
 *   · generation_canvas_submissions —— 提交意图关联（幂等 + 承接版本钉死）
 *   · generation_canvas_outputs —— 逐输出记录（$target 无行，状态在 submissions 行上）
 *   · generation_canvas_node_owners —— 节点唯一归属（原位再生成的跨提交唯一承接）
 *
 * 锁顺序（受理与保存一致，规格 B.3「受理事务顺序」/B.6「原子保存」）：
 *   项目行 → 画布行 → 节点归属行（按 node_id 排序）→ 提交关联 → 输出记录 → 任务写入。
 *   稳定项目行锁覆盖首次目标没有归属行的情形（无行可锁时靠它串行化竞争）。
 * ============================================ */
import { createHash } from "node:crypto";

import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  SAVE_CANVAS_RECOVERY_OPERATION,
  TARGET_OUTPUT_KEY,
  recoveryError,
  recoveryItemId,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
} from "@lib/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { linkPromptMaterials, markAudioMixCards, markOutputSlotsPlaced } from "./canvas-repo.js";
import type { CreatedJob } from "./generation-command-repo.js";
import { readCreateIdempotency, type CreateJobIdempotency } from "./generation-job-idempotency.js";

/** 新协议受控错误：带完整信封（code=HTTP 状态，data.reason 稳定值）。
 *  在事务内抛出 → Prisma 自动回滚 → 上层捕获并按信封直写响应（B.8 局部适配器）。 */
export class RecoveryContractError extends Error {
  constructor(readonly envelope: RecoveryErrorEnvelope) {
    super(envelope.msg);
  }
}

/** 受理入参（纯数据，由受理链路组装）。 */
export interface CanvasRecoveryAcceptance {
  projectId: string;
  userId: string;
  /** 已通过 canvasBindingSchema 校验的绑定。 */
  binding: CanvasBinding;
  /** 原业务操作命名空间（generation.create / generation.retry）。 */
  operation: string;
  /** 覆盖原业务参数与完整 canvas_binding 的规范化请求摘要。 */
  requestHash: string;
  /** 幂等键（已校验 == submission_id）。 */
  idempotencyKey: string;
  /** 任务类型（受理链路类型分派后填入）。 */
  taskType: string;
}

/** 受理事务锁内核对的产物：版本匹配后待写的关联计划（submission 行需要 job id，延后写）。 */
export interface CanvasRecoveryPlan {
  acceptance: CanvasRecoveryAcceptance;
  /** 本次受理的归属版本 = expected_binding_revision + 1。 */
  bindingRevision: number;
  /** 服务端从已保存画布捕获的原目标快照（result-placeholder 为 null）。 */
  previousTargetSnapshot: Record<string, unknown> | null;
  /** 被接管的前提交 id（首绑定为 null；接管时其目标项转 transferred）。 */
  supersededSubmissionId: string | null;
}

/** 画布节点快照的白名单键（B.5 CanvasNodeSnapshot；剥离活跃任务字段与 generationRecovery）。 */
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

/** 受理锁序：项目 → 画布。返回画布行（可能不存在）供快照捕获。 */
async function lockProjectAndCanvas(tx: Prisma.TransactionClient, projectId: bigint) {
  await tx.$queryRaw`SELECT id FROM project WHERE id = ${projectId} FOR UPDATE`;
  const canvasRows = await tx.$queryRaw<
    Array<{ version: number; nodes_json: unknown }>
  >`SELECT version, nodes_json FROM canvas WHERE project_id = ${projectId} FOR UPDATE`;
  return canvasRows[0] ?? null;
}

/**
 * 受理事务的锁内段（规格 B.3「受理事务顺序」2-4 步）：
 *   锁项目/画布 → 锁内回读幂等（命中同摘要=重放原关联；异摘要=冲突）→
 *   锁 owner 行 → 比对 expected_binding_revision（不匹配=canvas_binding_conflict，
 *   在任务写入与 billing.hold 前抛出，零写入零预扣）→ 捕获原目标快照。
 *
 * 返回 replay 分支时调用方应整体短路返回原 CreatedJob（本事务无写入）。
 */
export async function lockCanvasRecoveryForAcceptance(
  tx: Prisma.TransactionClient,
  acceptance: CanvasRecoveryAcceptance,
): Promise<
  | { kind: "replay"; result: CreatedJob }
  | { kind: "idempotency_conflict" }
  | { kind: "plan"; plan: CanvasRecoveryPlan }
> {
  const pid = BigInt(acceptance.projectId);
  // 1-2. 项目、画布锁序固定；画布行同时承载快照捕获（锁内读，无 TOCTOU）。
  const canvasRow = await lockProjectAndCanvas(tx, pid);
  // 3. 锁内幂等回读：同身份同载荷已受理 → 重放原关联，不重做任何当前状态校验。
  //    （readCreateIdempotency 收 PrismaClient，事务内用同语义的直读。）
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
  // 4. 节点归属行锁 + 版本比对。
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
  // 快照捕获 + 角色核对：draft/existing-media 必须对应服务端已保存画布上的节点，
  // 不接受自报角色替代事实；result-placeholder 允许受理后才建可见卡。
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
      supersededSubmissionId: null, // writeCanvasRecoveryRows 内解析（需要读旧 submission）
    },
  };
}

/**
 * 受理事务的写入段（job 行创建后、幂等行随 createJobWithinTx 既有次序）：
 *   submission 行（pending/1）+ owner 行（首绑定 create / 接管 update 版本+1、
 *   旧承接项改 transferred）。与 job 行同一事务提交（B.3 步骤 3）。
 */
export async function writeCanvasRecoveryRows(
  tx: Prisma.TransactionClient,
  plan: CanvasRecoveryPlan,
  jobId: bigint,
): Promise<void> {
  const { acceptance, bindingRevision } = plan;
  const pid = BigInt(acceptance.projectId);
  // 解析接管对象：owner 当前指向的 submission（无行=首绑定）。
  const ownerRows = await tx.$queryRaw<
    Array<{ generation_canvas_submission_id: bigint }>
  >`SELECT generation_canvas_submission_id FROM generation_canvas_node_owners
    WHERE project_id = ${pid} AND node_id = ${acceptance.binding.target_node_id} FOR UPDATE`;
  const previousOwnerId = ownerRows[0]?.generation_canvas_submission_id ?? null;
  // 插 submission 行（唯一约束 (project, submission_id) 兜底并发同身份的输家整体回滚）。
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
    // 新提交接管节点：旧提交的目标项转 transferred，项 revision +1；归属行版本推进。
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

/* ============================================
 * 恢复查询（B.5）：恢复页 + resolve。
 * 单页及 resolve 在一致性只读事务中读取关联、节点归属、任务和结果，
 * 避免把旧提交与同 jobId 的新重试状态拼接。分页不是跨请求快照，应用时再次校验版本。
 * ============================================ */

/** 恢复页游标（服务端编码校验）：协议版本、项目 ID、首屏最大提交记录 ID、最后扫描 ID。 */
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

/** 恢复页单条记录（公开形状，B.5 records 项）。 */
export interface RecoveryRecordView {
  submission_id: string;
  target_node_id: string;
  job_id: string;
  task_type: string;
  binding_revision: number;
  is_current: boolean;
  /** 既有公开 JobDetail 或 null（is_current=false 时不读取被复用 job 的当前状态）。 */
  job: Record<string, unknown> | null;
  recovery_seed: CanvasBinding["recovery_seed"] | null;
  previous_target_snapshot: Record<string, unknown> | null;
  items: RecoveryItemView[];
}

/** 恢复项（公开形状，B.5 items 项）。 */
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

/** generation_jobs 行 → 公开 JobDetail 投影（复用公开 GET 详情形状的字段子集；禁止直接暴露数据库实体）。 */
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
    created_at: row.gmt_create.toISOString(),
  };
}

/** 从任务可信终态数据计算尚未应用的虚拟输出项（pending/0，不写库；B.5）。
 *  单结果：job 有成功输出槽时计算 primary 项（输出槽/资产身份来自任务行，不按数组偶然顺序）。 */
function computeVirtualOutputItems(
  job: { status: string; output_asset_ids: unknown } | null,
  targetNodeId: string,
): Array<{ outputKey: string; nodeId: string; assetId: string | null }> {
  if (!job || job.status !== "succeeded") return [];
  const assets = Array.isArray(job.output_asset_ids) ? (job.output_asset_ids as unknown[]) : [];
  if (assets.length === 0) return [];
  return [{ outputKey: PRIMARY_OUTPUT_KEY, nodeId: targetNodeId, assetId: null }];
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

/** 单条 submission 行 → 公开 record（含 items）。currentOwnerNodes 为 owner 表当前指向本提交的 node 集。 */
function toRecoveryRecord(
  submission: RecoveryRecordRow,
  job: { status: string; output_asset_ids: unknown } | null,
  isCurrent: boolean,
  outputs: Array<{ output_key: string; node_id: string; asset_id: bigint | null; slot_id: bigint | null; state: string; revision: number }>,
  ownerRevisions: Map<string, number>,
): RecoveryRecordView {
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
    for (const virtual of computeVirtualOutputItems(job, submission.target_node_id)) {
      items.push({
        recovery_item_id: recoveryItemId(submission.submission_id, virtual.outputKey),
        output_key: virtual.outputKey,
        node_id: virtual.nodeId,
        state: "pending",
        revision: 0,
        node_binding_revision: 0,
        asset_id: virtual.assetId,
        slot_id: null,
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

/** 恢复页查询（一致性只读事务）。游标跨项目或非法由调用方判 400；此处按解码后的边界扫描。 */
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
      select: { id: true, type: true, status: true, progress: true, output_asset_ids: true, error: true, gmt_create: true },
    });
    const jobsById = new Map(jobs.map(job => [job.id, job]));
    const records = page
      .map(submission => {
        const owner = ownerByNode.get(submission.target_node_id);
        const isCurrent = owner !== undefined
          && owner.generation_canvas_submission_id === submission.id
          && owner.output_key === TARGET_OUTPUT_KEY;
        const job = jobsById.get(submission.generation_job_id) ?? null;
        return toRecoveryRecord(
          submission, job, isCurrent,
          outputsBySubmission.get(submission.id) ?? [],
          ownerRevisionByNode(owners.map(o => ({ node_id: o.node_id, binding_revision: o.binding_revision }))),
        );
      })
      // 查询返回拥有当前目标或仍拥有已持久结果节点的关联（B.5）。
      .filter(record => record.is_current || record.items.some(item => item.state !== "pending" && item.node_binding_revision > 0 && item.output_key !== TARGET_OUTPUT_KEY));
    const lastScanned = page[page.length - 1]!.id;
    const nextCursor = hasMore ? encodeRecoveryCursor({ v: CANVAS_RECOVERY_PROTOCOL_VERSION, projectId, maxId, lastId: Number(lastScanned) }) : null;
    return { records, nextCursor, canvasVersion: canvasRows?.version ?? null };
  });
}

/** resolve：按 recovery_item_ids 定向读取（只读、可重复、不修改状态）。
 *  查询不到的项整体 404（不猜测补建）。 */
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
      // gcr:<submission_id>:<output_key>；submission_id 固定 36 字符 UUID。
      const match = /^gcr:([0-9a-f-]{36}):(.+)$/.exec(itemId);
      if (!match) throw new RecoveryContractError(recoveryError(404, "恢复项不存在", RECOVERY_REASONS.resourceNotFound));
      submissionIds.add(match[1]!);
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
      select: { id: true, type: true, status: true, progress: true, output_asset_ids: true, error: true, gmt_create: true },
    });
    const jobsById = new Map(jobs.map(job => [job.id, job]));
    const ownerRevisions = ownerRevisionByNode(owners.map(o => ({ node_id: o.node_id, binding_revision: o.binding_revision })));
    return submissions.map(submission => {
      const owner = ownerByNode.get(submission.target_node_id);
      const isCurrent = owner !== undefined
        && owner.generation_canvas_submission_id === submission.id
        && owner.output_key === TARGET_OUTPUT_KEY;
      const record = toRecoveryRecord(
        submission, jobsById.get(submission.generation_job_id) ?? null, isCurrent,
        outputsBySubmission.get(submission.id) ?? [], ownerRevisions,
      );
      // 仅包含请求项及所属关联（B.5）。
      record.items = record.items.filter(item => wanted.has(item.recovery_item_id));
      return record;
    });
  });
}

/** 受理响应的 canvas_binding 视图（重放与首次受理共用；is_current 现查 owner 表）。 */
export async function canvasBindingView(
  prisma: PrismaClient,
  projectId: string,
  submissionId: string,
): Promise<{
  protocol_version: number;
  submission_id: string;
  target_node_id: string;
  binding_revision: number;
  job_id: string;
  is_current: boolean;
} | null> {
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

/** 项目是否存在新协议关联（B.7 保护性保存的开关）。 */
export async function projectHasRecoverySubmissions(prisma: PrismaClient, projectId: string): Promise<boolean> {
  const row = await prisma.generation_canvas_submissions.findFirst({
    where: { project_id: BigInt(projectId) },
    select: { id: true },
  });
  return row !== null;
}

/* ============================================
 * 保护性保存（B.6）：画布、恢复项、素材关联、槽位首次放置与紧凑回执同事务提交。
 * 幂等先于 If-Match 检查（同身份同摘要回放原回执不递增版本；异摘要拒绝）。
 * ============================================ */

export interface CanvasRecoverySaveInput {
  ownerId: string;
  projectId: string;
  /** 客户端实际读到的版本；null = "missing"（首次）。 */
  expectedVersion: number | null;
  viewport: string | null;
  nodes: string;
  edges: string;
  confirmEmpty: boolean;
  commandId: string;
  /** 同请求的恢复项不得重复（上层校验）。 */
  changes: Array<{ recoveryItemId: string; expectedRevision: number; action: string }>;
  /** 既有素材关联载荷（普通编辑素材，与 saveIfVersion 同口径）。 */
  materials?: { ownerId: string; items: Array<{ assetId: string; mediaType: string }> };
}

/** 紧凑回执（新协议成功 data；不保存完整画布历史）。 */
export interface CanvasRecoveryReceiptChange {
  recoveryItemId: string;
  revision: number;
  nodeBindingRevision: number;
  state: string;
}

export interface CanvasRecoverySaveResult {
  projectId: string;
  version: number;
  recoveryReceipt: {
    commandId: string;
    replayed: boolean;
    changes: CanvasRecoveryReceiptChange[];
  };
}

/** 保存请求摘要：If-Match + 完整文档 + confirmEmpty + 协议版本 + 显式变更（B.6）。 */
export function canvasRecoverySaveRequestHash(input: CanvasRecoverySaveInput): string {
  const canonical = JSON.stringify([
    input.expectedVersion,
    input.viewport,
    input.nodes,
    input.edges,
    input.confirmEmpty,
    CANVAS_RECOVERY_PROTOCOL_VERSION,
    [...input.changes].map(change => [change.recoveryItemId, change.expectedRevision, change.action])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/** 文档中一个节点的 generationRecovery 标记（无标记返回 null）。 */
function markerOf(node: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const marker = (node?.data as Record<string, unknown> | undefined)?.generationRecovery;
  return marker && typeof marker === "object" && !Array.isArray(marker) ? marker as Record<string, unknown> : null;
}

function markerMatches(marker: Record<string, unknown> | null, submissionId: string, outputKey: string): boolean {
  return marker !== null
    && marker.protocolVersion === CANVAS_RECOVERY_PROTOCOL_VERSION
    && marker.submissionId === submissionId
    && marker.outputKey === outputKey;
}

/** 单个恢复项的当前状态（$target 读 submission 行，其余读 outputs 行；无行=pending/0）。 */
interface ItemState {
  submissionRow: { id: bigint; submission_id: string; target_node_id: string; generation_job_id: bigint; target_state: string; target_revision: number; recovery_seed: unknown };
  outputKey: string;
  state: string;
  revision: number;
  outputRowId: bigint | null;
}

/**
 * 新协议原子保存。失败全部回滚（412 不确认展示或删除）；受控错误以
 * RecoveryContractError 冒泡（信封直写响应，不经全局过滤器）。
 */
export async function saveCanvasWithRecovery(
  prisma: PrismaClient,
  input: CanvasRecoverySaveInput,
): Promise<CanvasRecoverySaveResult> {
  const pid = BigInt(input.projectId);
  const requestHash = canvasRecoverySaveRequestHash(input);
  return prisma.$transaction(async (tx) => {
    // 锁序与受理一致：项目 → 画布 → 节点归属行（按 node_id 排序）。
    await tx.$queryRaw`SELECT id FROM project WHERE id = ${pid} FOR UPDATE`;
    const canvasRows = await tx.$queryRaw<
      Array<{ id: bigint; version: number; nodes_json: unknown }>
    >`SELECT id, version, nodes_json FROM canvas WHERE project_id = ${pid} FOR UPDATE`;
    const canvasRow = canvasRows[0] ?? null;
    // 幂等先于版本检查：同身份同摘要 → 回放原紧凑结果（replayed=true，不写库不递增版本）。
    const receiptRow = await tx.command_idempotency.findUnique({
      where: {
        project_id_operation_idempotency_key: {
          project_id: pid, operation: SAVE_CANVAS_RECOVERY_OPERATION, idempotency_key: input.commandId,
        },
      },
      select: { request_hash: true, result_payload: true },
    });
    if (receiptRow) {
      if (receiptRow.request_hash !== requestHash) {
        throw new RecoveryContractError(
          recoveryError(409, "保存命令已用于不同载荷", RECOVERY_REASONS.commandReused),
        );
      }
      const payload = receiptRow.result_payload as unknown as CanvasRecoverySaveResult;
      return { ...payload, recoveryReceipt: { ...payload.recoveryReceipt, replayed: true } };
    }
    // If-Match：没有版本不以服务端当前版本替代（B.6）。
    if (input.expectedVersion === null && canvasRow !== null) {
      throw new RecoveryContractError(
        recoveryError(412, "Canvas 版本冲突", RECOVERY_REASONS.versionConflict, { version: canvasRow.version }),
      );
    }
    if (input.expectedVersion !== null && (!canvasRow || canvasRow.version !== input.expectedVersion)) {
      throw new RecoveryContractError(
        recoveryError(412, "Canvas 版本冲突", RECOVERY_REASONS.versionConflict, { version: canvasRow ? canvasRow.version : null }),
      );
    }
    // 首次画布竞争由项目唯一约束兜底（与 saveIfVersion 同款：create 撞唯一键 → 条件写失败语义）。
    const incomingNodes = JSON.parse(input.nodes) as Array<Record<string, unknown>>;
    const incomingByNode = new Map(incomingNodes.map(node => [String(node.id), node]));
    // ── 解析恢复变更 → 当前状态读取 + 动作校验（B.6 五动作表）──
    const submissionsById = new Map<string, NonNullable<ItemState["submissionRow"]>>();
    const itemStates: ItemState[] = [];
    for (const change of input.changes) {
      const match = /^gcr:([0-9a-f-]{36}):(.+)$/.exec(change.recoveryItemId);
      if (!match) {
        throw new RecoveryContractError(recoveryError(400, "恢复项身份无效", RECOVERY_REASONS.invalidPayload));
      }
      const submissionId = match[1]!;
      const outputKey = match[2]!;
      let submissionRow = submissionsById.get(submissionId) ?? null;
      if (!submissionRow) {
        const row = await tx.generation_canvas_submissions.findUnique({
          where: { project_id_submission_id: { project_id: pid, submission_id: submissionId } },
        });
        if (!row) throw new RecoveryContractError(recoveryError(404, "恢复项不存在", RECOVERY_REASONS.resourceNotFound));
        submissionRow = row;
        submissionsById.set(submissionId, row);
      }
      let state: string;
      let revision: number;
      let outputRowId: bigint | null = null;
      if (outputKey === TARGET_OUTPUT_KEY) {
        state = submissionRow.target_state;
        revision = Number(submissionRow.target_revision);
      } else {
        const output = await tx.generation_canvas_outputs.findUnique({
          where: { generation_canvas_submission_id_output_key: { generation_canvas_submission_id: submissionRow.id, output_key: outputKey } },
        });
        state = output ? output.state : "pending";
        revision = output ? Number(output.revision) : 0;
        outputRowId = output?.id ?? null;
      }
      itemStates.push({ submissionRow, outputKey, state, revision, outputRowId });
    }
    // 锁定读取当前关联（B.6 步骤 2-3）：节点归属行按 node_id 排序 FOR UPDATE——
    // restore/settleTarget/replaceTarget 的「归属未交给另一项」判定必须在锁内成立，
    // 否则并发接管会让校验基于过期快照通过。
    const involvedNodes = [...new Set(itemStates.map(item => item.submissionRow.target_node_id))].sort();
    const ownerRows = await tx.$queryRaw<
      Array<{ node_id: string; generation_canvas_submission_id: bigint; output_key: string; binding_revision: number }>
    >`SELECT node_id, generation_canvas_submission_id, output_key, binding_revision
      FROM generation_canvas_node_owners WHERE project_id = ${pid}
      AND node_id IN (${Prisma.join(involvedNodes)}) FOR UPDATE`;
    const ownerByNode = new Map(ownerRows.map(owner => [owner.node_id, owner]));
    const changes: CanvasRecoveryReceiptChange[] = [];
    // 逐动作校验 + 生成写入计划（写入延后到画布写成功之后，整笔原子）。
    interface PlannedWrite {
      kind: "targetState" | "outputUpsert" | "ownerSwitch";
      submissionRow: NonNullable<ItemState["submissionRow"]>;
      outputKey: string;
      nextState: string;
      nextRevision: number;
      outputRowId: bigint | null;
    }
    const planned: PlannedWrite[] = [];
    const actionById = new Map(input.changes.map(change => [change.recoveryItemId, change.action]));
    for (let index = 0; index < input.changes.length; index += 1) {
      const change = input.changes[index]!;
      const item = itemStates[index]!;
      const node = incomingByNode.get(item.submissionRow.target_node_id);
      const marker = markerOf(node);
      const owner = ownerByNode.get(item.submissionRow.target_node_id);
      const owned = owner !== undefined && owner.generation_canvas_submission_id === item.submissionRow.id;
      const conflict = (currentState: string, currentRevision: number) =>
        new RecoveryContractError(
          recoveryError(409, "恢复项状态已变化，请刷新后重试", RECOVERY_REASONS.itemConflict, {
            currentRevision, currentState,
          }),
        );
      if (change.expectedRevision !== item.revision) throw conflict(item.state, item.revision);
      const plan = (nextState: string, outputKey = item.outputKey): PlannedWrite => ({
        kind: outputKey === TARGET_OUTPUT_KEY ? "targetState" : "outputUpsert",
        submissionRow: item.submissionRow, outputKey, nextState,
        nextRevision: item.revision + 1,
        outputRowId: item.outputRowId,
      });
      switch (change.action) {
        case "apply": {
          if (item.state !== "pending" && item.state !== "present") throw conflict(item.state, item.revision);
          if (!node || !markerMatches(marker, item.submissionRow.submission_id, item.outputKey)) {
            throw new RecoveryContractError(
              recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
            );
          }
          // 同状态且身份一致的重复 apply 是无副作用成功，不增加 revision（B.6）。
          if (item.state === "present") planned.push({ ...plan("present"), nextRevision: item.revision });
          else planned.push(plan("present"));
          break;
        }
        case "remove": {
          if (item.state !== "pending" && item.state !== "present" && item.state !== "removed") throw conflict(item.state, item.revision);
          if (item.state === "removed") { planned.push({ ...plan("removed"), nextRevision: item.revision }); break; }
          if (node && markerMatches(marker, item.submissionRow.submission_id, item.outputKey)) {
            throw new RecoveryContractError(
              recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
            );
          }
          if (item.outputKey !== TARGET_OUTPUT_KEY && item.outputRowId === null) {
            // 虚拟输出首次 remove：一对一 primary 必须与 replaceTarget 配套（B.6）。
            const paired = input.changes.some(other =>
              other.action === "replaceTarget"
              && /^gcr:([0-9a-f-]{36}):(.+)$/.exec(other.recoveryItemId)?.[1] === item.submissionRow.submission_id);
            if (!paired) {
              throw new RecoveryContractError(
                recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
              );
            }
          }
          planned.push(plan("removed"));
          break;
        }
        case "restore": {
          if (item.state !== "removed") throw conflict(item.state, item.revision);
          if (!owned) throw conflict(item.state, item.revision);
          if (!node || !markerMatches(marker, item.submissionRow.submission_id, item.outputKey)) {
            throw new RecoveryContractError(
              recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
            );
          }
          planned.push(plan("present"));
          break;
        }
        case "replaceTarget": {
          if (item.outputKey !== TARGET_OUTPUT_KEY) throw conflict(item.state, item.revision);
          if (item.state !== "pending" && item.state !== "present") throw conflict(item.state, item.revision);
          if (!owned) throw conflict(item.state, item.revision);
          const job = await tx.generation_jobs.findUnique({
            where: { id: item.submissionRow.generation_job_id },
            select: { status: true, output_asset_ids: true },
          });
          if (!job || job.status !== "succeeded" || !Array.isArray(job.output_asset_ids) || job.output_asset_ids.length === 0) {
            throw new RecoveryContractError(
              recoveryError(422, "任务尚未成功产出，不能转换目标", RECOVERY_REASONS.documentMismatch),
            );
          }
          planned.push(plan("replaced"));
          break;
        }
        case "settleTarget": {
          if (item.outputKey !== TARGET_OUTPUT_KEY) throw conflict(item.state, item.revision);
          if (item.state !== "pending" && item.state !== "present") throw conflict(item.state, item.revision);
          if (!owned) throw conflict(item.state, item.revision);
          const job = await tx.generation_jobs.findUnique({
            where: { id: item.submissionRow.generation_job_id },
            select: { status: true },
          });
          if (!job || job.status !== "cancelled") {
            throw new RecoveryContractError(
              recoveryError(422, "任务未确认取消，不能回退目标", RECOVERY_REASONS.documentMismatch),
            );
          }
          const seed = item.submissionRow.recovery_seed as { target?: { role?: string } } | null;
          const role = seed?.target?.role;
          if (role !== "draft" && role !== "existing-media") {
            throw new RecoveryContractError(
              recoveryError(422, "该目标没有可恢复的原素材或草稿", RECOVERY_REASONS.documentMismatch),
            );
          }
          if (!node) {
            throw new RecoveryContractError(
              recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
            );
          }
          planned.push(plan("present"));
          break;
        }
        default:
          throw new RecoveryContractError(recoveryError(400, "未知恢复动作", RECOVERY_REASONS.invalidPayload));
      }
    }
    // ── 写画布（先写文档，失败整体回滚）──
    const data = {
      viewport_json: input.viewport ? JSON.parse(input.viewport) : null,
      nodes_json: JSON.parse(input.nodes),
      edges_json: JSON.parse(input.edges),
    };
    const saved = canvasRow === null
      ? await tx.canvas.create({ data: { project_id: pid, ...data } })
      : await tx.canvas.update({ where: { id: canvasRow.id }, data: { ...data, version: { increment: 1 } } });
    // ── 既有素材关联 / 槽位首次放置 / audio_mix 卡副作用（与 saveIfVersion 同口径）──
    if (input.materials) await linkPromptMaterials(tx, pid, input.materials as never);
    await markOutputSlotsPlaced(tx, pid, data.nodes_json);
    await markAudioMixCards(tx, pid, data.nodes_json, input.ownerId);
    // ── 恢复状态写入 ──
    for (const write of planned) {
      if (write.kind === "targetState" || write.outputKey === TARGET_OUTPUT_KEY) {
        await tx.generation_canvas_submissions.update({
          where: { id: write.submissionRow.id },
          data: { target_state: write.nextState, target_revision: write.nextRevision, gmt_modified: new Date() },
        });
      } else if (write.outputRowId !== null) {
        await tx.generation_canvas_outputs.update({
          where: { id: write.outputRowId },
          data: { state: write.nextState, revision: write.nextRevision, gmt_modified: new Date() },
        });
      } else {
        // 虚拟输出首次落行（apply/remove 都在此建行；remove 时直接 removed/1）。
        await tx.generation_canvas_outputs.create({
          data: {
            generation_canvas_submission_id: write.submissionRow.id,
            output_key: write.outputKey,
            node_id: write.submissionRow.target_node_id,
            state: write.nextState,
            revision: Math.max(1, write.nextRevision),
          },
        });
      }
      // 一对一转换（同提交 replaceTarget+primary 动作）：owner 从 $target 切到 primary，不推进版本。
      if (write.outputKey === PRIMARY_OUTPUT_KEY) {
        await tx.generation_canvas_node_owners.update({
          where: { project_id_node_id: { project_id: pid, node_id: write.submissionRow.target_node_id } },
          data: { output_key: PRIMARY_OUTPUT_KEY, gmt_modified: new Date() },
        });
      }
    }
    // ── 紧凑回执 ──
    for (let index = 0; index < input.changes.length; index += 1) {
      const write = planned[index]!;
      const owner = ownerByNode.get(write.submissionRow.target_node_id);
      changes.push({
        recoveryItemId: input.changes[index]!.recoveryItemId,
        revision: write.nextRevision,
        nodeBindingRevision: owner ? Number(owner.binding_revision) : 0,
        state: write.nextState,
      });
    }
    const result: CanvasRecoverySaveResult = {
      projectId: input.projectId,
      version: saved.version,
      recoveryReceipt: { commandId: input.commandId, replayed: false, changes },
    };
    await tx.command_idempotency.create({
      data: {
        project_id: pid,
        operation: SAVE_CANVAS_RECOVERY_OPERATION,
        idempotency_key: input.commandId,
        request_hash: requestHash,
        accepted_cursor: 0n,
        result_payload: result as never,
      },
    });
    return result;
  }, { maxWait: 10_000, timeout: 30_000 });
}

/* ── B.7 旧客户端边界：受保护项目的整文档写守护 ──────────────────────────── */

/** 画布节点上的受保护标记读取（generationRecovery）。 */
export function recoveryMarkerOfNode(node: Record<string, unknown>): Record<string, unknown> | null {
  return markerOf(node);
}

/**
 * 旧请求（无恢复协议字段）改动新协议承接/受保护结果的守护（B.7）。
 * previous/incoming 为解析后的节点数组；命中违规抛 428 recovery_protocol_required。
 * 允许：受保护卡的名字、位置、尺寸普通编辑；拒绝：新增/删除受保护标记、改变承接、
 * 任务身份或结果资产；没有变更却使受保护卡缺席。
 */
export function guardLegacyCanvasWrite(
  previous: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
): void {
  const previousMarkers = new Map<string, Record<string, unknown>>();
  for (const node of previous) {
    const marker = markerOf(node);
    if (marker) previousMarkers.set(String(node.id), marker);
  }
  const incomingById = new Map(incoming.map(node => [String(node.id), node]));
  const reject = (): never => {
    throw new RecoveryContractError(
      recoveryError(428, "该项目已启用任务恢复保护，请刷新客户端后处理", RECOVERY_REASONS.protocolRequired),
    );
  };
  // 没有恢复变更却使受保护卡缺席 → 拒绝。
  for (const [nodeId, marker] of previousMarkers) {
    const node = incomingById.get(nodeId) ?? reject();
    // 标记/承接/任务身份不可变；结果资产（mediaNode.assetId）不可变。
    const nextMarker = markerOf(node);
    if (JSON.stringify(nextMarker) !== JSON.stringify(marker)) reject();
    const previousNode = previous.find(item => String(item.id) === nodeId)!;
    if ((previousNode.type ?? null) !== (node.type ?? null)) reject();
    const previousAsset = (previousNode.data as Record<string, unknown> | undefined)?.assetId ?? null;
    const nextAsset = (node.data as Record<string, unknown> | undefined)?.assetId ?? null;
    if (previousAsset !== null && previousAsset !== nextAsset) reject();
  }
  // 新增受保护标记须走新协议。
  for (const node of incoming) {
    const marker = markerOf(node);
    if (marker && !previousMarkers.has(String(node.id))) reject();
  }
}
