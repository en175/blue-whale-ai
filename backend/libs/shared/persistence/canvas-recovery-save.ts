/* ============================================
 * IKJJQU（IKIXK9-SPEC-20261002 B.6/B.7）：保护性保存与旧客户端守护。
 * 从 generation-canvas-recovery-repo 拆出（800 行硬线）——受理/查询留在原文件。
 * ============================================ */
import { createHash } from "node:crypto";

import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  SAVE_CANVAS_RECOVERY_OPERATION,
  TARGET_OUTPUT_KEY,
  recoveryError,
} from "@lib/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { linkPromptMaterials, markAudioMixCards, markOutputSlotsPlaced } from "./canvas-repo.js";
import { RecoveryContractError } from "./generation-canvas-recovery-repo.js";

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
