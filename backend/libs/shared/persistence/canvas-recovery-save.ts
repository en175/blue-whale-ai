



import { createHash } from "node:crypto";

import {
  CANVAS_RECOVERY_PROTOCOL_VERSION,
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  SAVE_CANVAS_RECOVERY_OPERATION,
  TARGET_OUTPUT_KEY,
  parseRecoveryItemId,
  recoveryError,
} from "@lib/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { edgeFromRow, linkPromptMaterials, markAudioMixCards, markOutputSlotsPlaced, nodeFromRow, touchProjectEdited } from "./canvas-repo.js";
import { RecoveryContractError, canvasNodesOf, loadRecoveryOwners, type RecoveryNodeOwner } from "./generation-canvas-recovery-repo.js";
import { stableJson } from "../canvas/apply-diff.js";
import { CanvasRowsWriteError, replaceCanvasRows } from "./canvas-rows-replace.js";
import {
  isMultiResultOutputKey,
  outputNodeIdForKey,
  projectVirtualOutputs,
  trustedAssetIdOf,
  type ProjectableJob,
  type VirtualOutputItem,
  type VirtualOutputProjection,
} from "./canvas-recovery-multi-output.js";






export interface CanvasRecoverySaveInput {
  ownerId: string;
  projectId: string;

  expectedVersion: number | null;
  viewport: string | null;
  nodes: string;
  edges: string;
  confirmEmpty: boolean;
  commandId: string;

  changes: Array<{ recoveryItemId: string; expectedRevision: number; action: string }>;

  materials?: { ownerId: string; items: Array<{ assetId: string; mediaType: string }> };
}


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

async function canvasContentMatches(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  nodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
): Promise<boolean> {
  const [nodeRows, edgeRows] = await Promise.all([
    tx.project_nodes.findMany({ where: { project_id: projectId, is_delete: 0 } }),
    tx.project_edges.findMany({ where: { project_id: projectId, is_delete: 0 } }),
  ]);
  if (nodeRows.length !== nodes.length || edgeRows.length !== edges.length) return false;
  const nodeById = new Map(nodeRows.map((row) => [row.node_id, nodeFromRow(row)]));
  for (const node of nodes) {
    const row = nodeById.get(String(node.id));
    if (!row || stableJson(row) !== stableJson(node)) return false;
  }
  const edgeById = new Map(edgeRows.map((row) => [row.edge_id, edgeFromRow(row)]));
  for (const edge of edges) {
    const row = edgeById.get(String(edge.id));
    if (!row || stableJson(row) !== stableJson(edge)) return false;
  }
  return true;
}

const MARKER_IDENTITY_KEYS = ["protocolVersion", "submissionId", "outputKey"] as const;

function sameMarkerIdentity(previousMarker: Record<string, unknown>, nextMarker: Record<string, unknown> | null): boolean {
  if (nextMarker === null) return false;
  if (!(MARKER_IDENTITY_KEYS as readonly string[]).every(key => key in nextMarker)) return false;
  return (MARKER_IDENTITY_KEYS as readonly string[]).every(key => previousMarker[key] === nextMarker[key]);
}

function protectedCardKept(previousNode: Record<string, unknown>, node: Record<string, unknown>): boolean {
  const previousMarker = markerOf(previousNode);
  if (previousMarker === null) return true;
  if (!sameMarkerIdentity(previousMarker, markerOf(node))) return false;
  if ((previousNode.type ?? null) !== (node.type ?? null)) return false;
  const previousAsset = (previousNode.data as Record<string, unknown> | undefined)?.assetId ?? null;
  const nextAsset = (node.data as Record<string, unknown> | undefined)?.assetId ?? null;
  return previousAsset === null || previousAsset === nextAsset;
}




interface ItemState {
  submissionRow: { id: bigint; submission_id: string; target_node_id: string; generation_job_id: bigint; target_state: string; target_revision: number; recovery_seed: unknown };
  outputKey: string;
  state: string;
  revision: number;
  outputRowId: bigint | null;
  nodeId: string;
}




function projectionOrThrow(
  projection: VirtualOutputProjection,
): asserts projection is Extract<VirtualOutputProjection, { kind: "ok" }> {
  if (projection.kind === "invalid") {
    throw new RecoveryContractError(
      recoveryError(422, "服务端无法得到无歧义输出映射", RECOVERY_REASONS.projectionInvalid),
    );
  }
}





export async function saveCanvasWithRecovery(
  prisma: PrismaClient,
  input: CanvasRecoverySaveInput,
): Promise<CanvasRecoverySaveResult> {
  const pid = BigInt(input.projectId);
  const requestHash = canvasRecoverySaveRequestHash(input);
  return prisma.$transaction(async (tx) => {

    await tx.$queryRaw`SELECT id FROM project WHERE id = ${pid} FOR UPDATE`;
    const canvasRows = await tx.$queryRaw<
      Array<{ id: bigint; version: number; viewport_json: unknown; nodes_json: unknown; edges_json: unknown; rows_authoritative: number }>
    >`SELECT id, version, viewport_json, nodes_json, edges_json, rows_authoritative FROM project_canvas WHERE project_id = ${pid} FOR UPDATE`;
    const canvasRow = canvasRows[0] ?? null;

    const receiptRow = await tx.project_command_receipts.findUnique({
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

    const incomingNodes = JSON.parse(input.nodes) as Array<Record<string, unknown>>;
    const incomingByNode = new Map(incomingNodes.map(node => [String(node.id), node]));

    const submissionsById = new Map<string, NonNullable<ItemState["submissionRow"]>>();
    const itemStates: ItemState[] = [];
    for (const change of input.changes) {
      const parsed = parseRecoveryItemId(change.recoveryItemId);
      if (!parsed) {
        throw new RecoveryContractError(recoveryError(400, "恢复项身份无效", RECOVERY_REASONS.invalidPayload));
      }
      const submissionId = parsed.submissionId;
      const outputKey = parsed.outputKey;
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
      let nodeId: string;
      if (outputKey === TARGET_OUTPUT_KEY) {
        state = submissionRow.target_state;
        revision = Number(submissionRow.target_revision);
        nodeId = submissionRow.target_node_id;
      } else {
        const output = await tx.generation_canvas_outputs.findUnique({
          where: { generation_canvas_submission_id_output_key: { generation_canvas_submission_id: submissionRow.id, output_key: outputKey } },
        });
        state = output ? output.state : "pending";
        revision = output ? Number(output.revision) : 0;
        outputRowId = output?.id ?? null;

        nodeId = output ? output.node_id : outputNodeIdForKey(outputKey, {
          submissionId: submissionRow.submission_id,
          targetNodeId: submissionRow.target_node_id,
        });
      }
      itemStates.push({ submissionRow, outputKey, state, revision, outputRowId, nodeId });
    }




    const previousNodes = await canvasNodesOf(tx, pid, canvasRow);
    const involvedNodes = [...new Set([
      ...itemStates.map(item => item.nodeId),
      ...previousNodes.filter(node => markerOf(node) !== null).map(node => String(node.id)),
    ])].sort();
    const ownerByNode = involvedNodes.length > 0
      ? await loadRecoveryOwners(tx, pid, involvedNodes)
      : new Map<string, RecoveryNodeOwner>();
    const ownerSubmissionRows = ownerByNode.size > 0
      ? await tx.generation_canvas_submissions.findMany({
          where: { id: { in: [...ownerByNode.values()].map(owner => owner.submissionId) } },
          select: { id: true, submission_id: true },
        })
      : [];
    const ownerSubmissionIdByRowId = new Map(ownerSubmissionRows.map(row => [row.id.toString(), row.submission_id]));
    const ownerOfNode = (nodeId: string): { submissionId: string; outputKey: string } | null => {
      const owner = ownerByNode.get(nodeId);
      if (owner === undefined) return null;
      const ownerSubmissionId = ownerSubmissionIdByRowId.get(owner.submissionId.toString());
      return ownerSubmissionId === undefined ? null : { submissionId: ownerSubmissionId, outputKey: owner.outputKey };
    };
    const changes: CanvasRecoveryReceiptChange[] = [];


    const projectionCache = new Map<string, { projection: VirtualOutputProjection; job: ProjectableJob | null }>();
    const projectionOf = async (submissionRow: NonNullable<ItemState["submissionRow"]>): Promise<{ projection: VirtualOutputProjection; job: ProjectableJob | null }> => {
      const cached = projectionCache.get(submissionRow.submission_id);
      if (cached) return cached;
      const job = await tx.generation_jobs.findUnique({
        where: { id: submissionRow.generation_job_id },
        select: { id: true, type: true, status: true, output_asset_ids: true, input: true },
      });
      const projection = await projectVirtualOutputs(tx, {
        submissionId: submissionRow.submission_id,
        targetNodeId: submissionRow.target_node_id,
        job,
      });
      const entry = { projection, job };
      projectionCache.set(submissionRow.submission_id, entry);
      return entry;
    };

    const persistedKeysCache = new Map<string, Set<string>>();
    const persistedKeysOf = async (
      submissionRow: NonNullable<ItemState["submissionRow"]>,
    ): Promise<Set<string>> => {
      const cached = persistedKeysCache.get(submissionRow.submission_id);
      if (cached) return cached;
      const keys = new Set(
        (await tx.generation_canvas_outputs.findMany({
          where: { generation_canvas_submission_id: submissionRow.id },
          select: { output_key: true },
        })).map(row => row.output_key),
      );
      persistedKeysCache.set(submissionRow.submission_id, keys);
      return keys;
    };

    const assertVirtualKeyProjected = async (item: ItemState): Promise<VirtualOutputItem | null> => {
      if (item.outputRowId !== null) return null;
      const { projection } = await projectionOf(item.submissionRow);
      projectionOrThrow(projection);
      const virtual = projection.items.find(candidate => candidate.outputKey === item.outputKey) ?? null;
      if (virtual === null) {
        throw new RecoveryContractError(
          recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
        );
      }
      return virtual;
    };


    const trustedAssetOf = async (item: ItemState): Promise<string | null> => {
      const { projection, job } = await projectionOf(item.submissionRow);
      projectionOrThrow(projection);
      return trustedAssetIdOf(projection, job, item.outputKey);
    };

    const persistedAssetOf = async (item: ItemState): Promise<bigint | null> => {
      const assetId = await trustedAssetOf(item);
      return assetId === null ? null : BigInt(assetId);
    };



    const assertTrustedResultAsset = async (item: ItemState, node: Record<string, unknown> | undefined): Promise<void> => {
      const trusted = await trustedAssetOf(item);
      const declared = (node?.data as Record<string, unknown> | undefined)?.assetId ?? null;
      if (trusted === null || declared === null || String(declared) !== trusted) {
        throw new RecoveryContractError(
          recoveryError(422, "结果资产与任务可信产物不一致", RECOVERY_REASONS.documentMismatch),
        );
      }
    };

    interface PlannedWrite {
      kind: "targetState" | "outputUpsert" | "ownerSwitch";
      submissionRow: NonNullable<ItemState["submissionRow"]>;
      outputKey: string;
      nextState: string;
      nextRevision: number;
      outputRowId: bigint | null;

      nodeId: string;

      slotId: string | null;

      assetId: bigint | null;

      createOwner: boolean;
    }
    const planned: PlannedWrite[] = [];
    const aligned: PlannedWrite[] = [];
    for (let index = 0; index < input.changes.length; index += 1) {
      const change = input.changes[index]!;
      const item = itemStates[index]!;
      const node = incomingByNode.get(item.nodeId);
      const marker = markerOf(node);
      const owner = ownerByNode.get(item.nodeId);
      const owned = owner !== undefined && owner.submissionId === item.submissionRow.id
        && owner.outputKey === item.outputKey;
      const conflict = (currentState: string, currentRevision: number) =>
        new RecoveryContractError(
          recoveryError(409, "恢复项状态已变化，请刷新后重试", RECOVERY_REASONS.itemConflict, {
            currentRevision, currentState,
          }),
        );
      const nodeConflict = () => new RecoveryContractError(
        recoveryError(409, "结果节点已被其他提交占用", RECOVERY_REASONS.itemConflict, {
          nodeId: item.nodeId,
          submissionId: item.submissionRow.submission_id,
          outputKey: item.outputKey,
          currentRevision: item.revision,
          currentState: item.state,
        }),
      );
      if (change.expectedRevision !== item.revision) throw conflict(item.state, item.revision);
      const plan = (nextState: string, outputKey = item.outputKey): PlannedWrite => ({
        kind: outputKey === TARGET_OUTPUT_KEY ? "targetState" : "outputUpsert",
        submissionRow: item.submissionRow, outputKey, nextState,
        nextRevision: item.revision + 1,
        outputRowId: item.outputRowId,
        nodeId: item.nodeId,
        slotId: null,
        assetId: null,
        createOwner: false,
      });
      switch (change.action) {
        case "apply": {
          if (item.state !== "pending" && item.state !== "present") throw conflict(item.state, item.revision);
          if (!node || !markerMatches(marker, item.submissionRow.submission_id, item.outputKey)) {
            throw new RecoveryContractError(
              recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
            );
          }

          if (item.outputKey !== TARGET_OUTPUT_KEY) {
            await assertTrustedResultAsset(item, node);
          }



          if (item.outputKey === PRIMARY_OUTPUT_KEY
            && (owner === undefined || owner.submissionId !== item.submissionRow.id)) {
            throw nodeConflict();
          }

          if (item.outputKey === PRIMARY_OUTPUT_KEY && item.outputRowId === null) {
            const paired = input.changes.some(other => {
              const ids = parseRecoveryItemId(other.recoveryItemId);
              return other.action === "replaceTarget"
                && ids?.submissionId === item.submissionRow.submission_id
                && ids.outputKey === TARGET_OUTPUT_KEY;
            });
            if (!paired) {
              throw new RecoveryContractError(
                recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
              );
            }
          }

          let slotId: string | null = null;
          let assetId: bigint | null = null;
          if (item.outputRowId === null && item.outputKey !== TARGET_OUTPUT_KEY) {
            const virtual = await assertVirtualKeyProjected(item);
            slotId = virtual?.slotId ?? null;
            assetId = await persistedAssetOf(item);
            if (isMultiResultOutputKey(item.outputKey) && owner !== undefined && !owned) {
              throw nodeConflict();
            }
          }

          if (item.state === "present") {
            planned.push({ ...plan("present"), nextRevision: item.revision, slotId, assetId });
          } else {
            const write = plan("present");
            planned.push({
              ...write, slotId, assetId,

              createOwner: item.outputRowId === null && isMultiResultOutputKey(item.outputKey),
            });
          }
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
          if (item.outputKey === TARGET_OUTPUT_KEY) {


            const job = await tx.generation_jobs.findUnique({
              where: { id: item.submissionRow.generation_job_id },
              select: { status: true },
            });
            if (!job || (job.status !== "cancelled" && job.status !== "failed")) {
              throw new RecoveryContractError(
                recoveryError(409, "任务尚未取消，不能删除目标", RECOVERY_REASONS.itemConflict, {
                  currentRevision: item.revision, currentState: item.state,
                }),
              );
            }
          }
          if (item.outputKey !== TARGET_OUTPUT_KEY && item.outputRowId === null) {
            if (item.outputKey === PRIMARY_OUTPUT_KEY) {

              const paired = input.changes.some(other =>
                other.action === "replaceTarget"
                && parseRecoveryItemId(other.recoveryItemId)?.submissionId === item.submissionRow.submission_id);
              if (!paired) {
                throw new RecoveryContractError(
                  recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
                );
              }
            } else {


              await assertVirtualKeyProjected(item);
              if (owner !== undefined && !owned) {
                throw nodeConflict();
              }
              planned.push({ ...plan("removed"), createOwner: true, assetId: await persistedAssetOf(item) });
              break;
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

          if (item.outputKey !== TARGET_OUTPUT_KEY) {
            await assertTrustedResultAsset(item, node);
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


          const { projection, job: projectedJob } = await projectionOf(item.submissionRow);
          projectionOrThrow(projection);
          const persistedKeys = await persistedKeysOf(item.submissionRow);
          for (const virtual of projection.items) {
            if (persistedKeys.has(virtual.outputKey)) continue;
            const handled = input.changes.some(other => {
              const ids = parseRecoveryItemId(other.recoveryItemId);
              return ids?.submissionId === item.submissionRow.submission_id
                && ids.outputKey === virtual.outputKey
                && (other.action === "apply" || other.action === "remove");
            });
            if (handled) continue;
            const asset = trustedAssetIdOf(projection, projectedJob, virtual.outputKey);
            aligned.push({
              kind: "outputUpsert",
              submissionRow: item.submissionRow,
              outputKey: virtual.outputKey,
              nextState: "present",
              nextRevision: 1,
              outputRowId: null,
              nodeId: virtual.nodeId,
              slotId: virtual.slotId,
              assetId: asset === null ? null : BigInt(asset),
              createOwner: isMultiResultOutputKey(virtual.outputKey),
            });
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






    const declaredKeys = new Set(itemStates.map(item => `${item.submissionRow.submission_id}:${item.outputKey}`));
    const undeclaredAbsent: Array<{ submissionId: string; outputKey: string }> = [];
    for (const previousNode of previousNodes) {
      const marker = markerOf(previousNode);
      if (!marker) continue;
      const submissionId = String(marker.submissionId);
      const outputKey = String(marker.outputKey);
      if (declaredKeys.has(`${submissionId}:${outputKey}`)) continue;
      const owner = ownerOfNode(String(previousNode.id));
      const supersededOwner = owner !== null && !(owner.submissionId === submissionId && owner.outputKey === outputKey)
        ? owner
        : null;
      const node = incomingByNode.get(String(previousNode.id));
      if (node === undefined) {
        if (supersededOwner === null) {
          undeclaredAbsent.push({ submissionId, outputKey });
        } else if (!declaredKeys.has(`${supersededOwner.submissionId}:${supersededOwner.outputKey}`)) {
          undeclaredAbsent.push({ submissionId: supersededOwner.submissionId, outputKey: supersededOwner.outputKey });
        }
        continue;
      }
      const tampered = () => new RecoveryContractError(
        recoveryError(422, "未声明的受保护项被改动，须以显式恢复动作变更", RECOVERY_REASONS.documentMismatch),
      );
      const incoming = markerOf(node);
      if (incoming !== null && String(incoming.outputKey) !== TARGET_OUTPUT_KEY
        && !isMultiResultOutputKey(String(incoming.outputKey))
        && declaredKeys.has(`${String(incoming.submissionId)}:${String(incoming.outputKey)}`)) continue;
      if (supersededOwner !== null
        && markerMatches(incoming, supersededOwner.submissionId, supersededOwner.outputKey)) continue;
      if (!markerMatches(incoming, submissionId, outputKey) || !protectedCardKept(previousNode, node)) throw tampered();
    }



    if (undeclaredAbsent.length > 0) {
      const absentMismatch = () => new RecoveryContractError(
        recoveryError(422, "未声明的受保护项从画布缺席，删除须以显式 remove 动作声明", RECOVERY_REASONS.documentMismatch),
      );
      const submissionIds = [...new Set(undeclaredAbsent.map(item => item.submissionId))];
      const submissionRows = await tx.generation_canvas_submissions.findMany({
        where: { project_id: pid, submission_id: { in: submissionIds } },
      });
      const rowBySubmissionId = new Map(submissionRows.map(row => [row.submission_id, row]));
      const outputKeys = [...new Set(undeclaredAbsent
        .filter(item => item.outputKey !== TARGET_OUTPUT_KEY)
        .map(item => item.outputKey))];
      const outputRows = outputKeys.length > 0 && submissionRows.length > 0
        ? await tx.generation_canvas_outputs.findMany({
            where: {
              generation_canvas_submission_id: { in: submissionRows.map(row => row.id) },
              output_key: { in: outputKeys },
            },
          })
        : [];
      const outputStateByKey = new Map(outputRows.map(row => [`${row.generation_canvas_submission_id}:${row.output_key}`, row.state]));
      for (const item of undeclaredAbsent) {
        const row = rowBySubmissionId.get(item.submissionId);
        if (!row) throw absentMismatch();
        const state = item.outputKey === TARGET_OUTPUT_KEY
          ? row.target_state
          : outputStateByKey.get(`${row.id}:${item.outputKey}`) ?? "pending";
        if (state !== "removed") throw absentMismatch();
      }
    }
    const keptMarkerKeys = new Set<string>();
    for (const previousNode of previousNodes) {
      const previousMarker = markerOf(previousNode);
      if (previousMarker) {
        keptMarkerKeys.add(`${String(previousNode.id)}:${String(previousMarker.submissionId)}:${String(previousMarker.outputKey)}`);
      }
    }
    const forgedMarker = () => new RecoveryContractError(
      recoveryError(422, "画布文档包含未经显式恢复动作的受保护标记", RECOVERY_REASONS.documentMismatch),
    );
    const declaredNodeIdByKey = new Map(
      itemStates.map(item => [`${item.submissionRow.submission_id}:${item.outputKey}`, item.nodeId]),
    );
    const submissionRowOf = async (submissionId: string) => {
      const cached = submissionsById.get(submissionId);
      if (cached) return cached;
      const row = await tx.generation_canvas_submissions.findUnique({
        where: { project_id_submission_id: { project_id: pid, submission_id: submissionId } },
      });
      if (!row) throw forgedMarker();
      submissionsById.set(submissionId, row);
      return row;
    };
    const seenNodeIds = new Set<string>();
    const markerNodeIds = new Set<string>();
    for (const node of incomingNodes) {
      const id = String(node.id);
      const marked = markerOf(node) !== null;
      if ((marked && seenNodeIds.has(id)) || (!marked && markerNodeIds.has(id))) throw forgedMarker();
      seenNodeIds.add(id);
      if (marked) markerNodeIds.add(id);
    }
    for (const node of incomingNodes) {
      const marker = markerOf(node);
      if (!marker) continue;
      if (marker.protocolVersion !== CANVAS_RECOVERY_PROTOCOL_VERSION
        || typeof marker.submissionId !== "string" || typeof marker.outputKey !== "string") throw forgedMarker();
      const submissionId = String(marker.submissionId);
      const outputKey = String(marker.outputKey);
      const declaredNodeId = declaredNodeIdByKey.get(`${submissionId}:${outputKey}`);
      if (declaredNodeId !== undefined) {
        if (String(node.id) !== declaredNodeId) throw forgedMarker();
        continue;
      }
      if (keptMarkerKeys.has(`${String(node.id)}:${submissionId}:${outputKey}`)) continue;
      const submissionRow = await submissionRowOf(submissionId);
      if (outputKey === TARGET_OUTPUT_KEY) {
        if (submissionRow.target_state !== "pending" && submissionRow.target_state !== "present") throw forgedMarker();
        if (String(node.id) !== submissionRow.target_node_id) throw forgedMarker();
        continue;
      }
      const { projection } = await projectionOf(submissionRow);
      projectionOrThrow(projection);
      const projectionItem = projection.items.find(item => item.outputKey === outputKey);
      if (!projectionItem || String(node.id) !== projectionItem.nodeId) throw forgedMarker();
      const outputRow = await tx.generation_canvas_outputs.findUnique({
        where: { generation_canvas_submission_id_output_key: { generation_canvas_submission_id: submissionRow.id, output_key: outputKey } },
      });
      if (outputRow !== null) throw forgedMarker();
    }

    const alignedKeys = new Set([
      ...planned.map(write => `${write.submissionRow.submission_id}:${write.outputKey}`),
      ...aligned.map(write => `${write.submissionRow.submission_id}:${write.outputKey}`),
    ]);
    const alignmentCandidates: Array<{
      node: Record<string, unknown>;
      submissionRow: NonNullable<ItemState["submissionRow"]>;
      markerOutputKey: string;
    }> = [];
    const candidateSubmissionIds = new Set<string>();
    for (const node of incomingNodes) {
      const marker = markerOf(node);
      if (marker === null || marker.protocolVersion !== CANVAS_RECOVERY_PROTOCOL_VERSION) continue;
      const markerOutputKey = String(marker.outputKey);
      if (markerOutputKey === TARGET_OUTPUT_KEY) continue;
      const declaredAsset = (node.data as Record<string, unknown> | undefined)?.assetId ?? null;
      if (declaredAsset === null || declaredAsset === "") continue;
      candidateSubmissionIds.add(String(marker.submissionId));
    }
    const unknownSubmissionIds = [...candidateSubmissionIds].filter(submissionId => !submissionsById.has(submissionId));
    if (unknownSubmissionIds.length > 0) {
      const rows = await tx.generation_canvas_submissions.findMany({
        where: { project_id: pid, submission_id: { in: unknownSubmissionIds } },
      });
      for (const row of rows) submissionsById.set(row.submission_id, row);
    }
    for (const node of incomingNodes) {
      const marker = markerOf(node);
      if (marker === null || marker.protocolVersion !== CANVAS_RECOVERY_PROTOCOL_VERSION) continue;
      const markerOutputKey = String(marker.outputKey);
      if (markerOutputKey === TARGET_OUTPUT_KEY) continue;
      const declaredAsset = (node.data as Record<string, unknown> | undefined)?.assetId ?? null;
      if (declaredAsset === null || declaredAsset === "") continue;
      const submissionRow = submissionsById.get(String(marker.submissionId));
      if (submissionRow === undefined || submissionRow.target_state !== "replaced") continue;
      alignmentCandidates.push({ node, submissionRow, markerOutputKey });
    }
    const candidateRowsToLoad = [...new Map(
      alignmentCandidates
        .map(candidate => candidate.submissionRow)
        .filter(row => !persistedKeysCache.has(row.submission_id))
        .map(row => [row.submission_id, row]),
    ).values()];
    if (candidateRowsToLoad.length > 0) {
      for (const row of candidateRowsToLoad) persistedKeysCache.set(row.submission_id, new Set());
      const outputRows = await tx.generation_canvas_outputs.findMany({
        where: { generation_canvas_submission_id: { in: candidateRowsToLoad.map(row => row.id) } },
        select: { generation_canvas_submission_id: true, output_key: true },
      });
      for (const outputRow of outputRows) {
        const submissionRow = candidateRowsToLoad.find(row => row.id === outputRow.generation_canvas_submission_id);
        if (submissionRow === undefined) continue;
        persistedKeysCache.get(submissionRow.submission_id)!.add(outputRow.output_key);
      }
    }
    for (const candidate of alignmentCandidates) {
      const { submissionRow, markerOutputKey } = candidate;
      if (persistedKeysCache.get(submissionRow.submission_id)!.size > 0) continue;
      const { projection, job } = await projectionOf(submissionRow);
      projectionOrThrow(projection);
      const trusted = trustedAssetIdOf(projection, job, markerOutputKey);
      if (trusted === null) continue;
      const declaredAsset = (candidate.node.data as Record<string, unknown>).assetId;
      if (String(declaredAsset) !== trusted) {
        throw new RecoveryContractError(
          recoveryError(422, "结果资产与任务可信产物不一致", RECOVERY_REASONS.documentMismatch, {
            nodeId: String(candidate.node.id),
            submissionId: submissionRow.submission_id,
            outputKey: markerOutputKey,
          }),
        );
      }
      for (const virtual of projection.items) {
        const key = `${submissionRow.submission_id}:${virtual.outputKey}`;
        if (alignedKeys.has(key)) continue;
        alignedKeys.add(key);
        const asset = trustedAssetIdOf(projection, job, virtual.outputKey);
        aligned.push({
          kind: "outputUpsert",
          submissionRow,
          outputKey: virtual.outputKey,
          nextState: "present",
          nextRevision: 1,
          outputRowId: null,
          nodeId: virtual.nodeId,
          slotId: virtual.slotId,
          assetId: asset === null ? null : BigInt(asset),
          createOwner: isMultiResultOutputKey(virtual.outputKey),
        });
      }
    }
    const ownerWriteNodeIds = [...new Set(aligned.filter(write => write.createOwner).map(write => write.nodeId))];
    if (ownerWriteNodeIds.length > 0) {
      const existingOwnerByNode = await loadRecoveryOwners(tx, pid, ownerWriteNodeIds);
      for (let index = aligned.length - 1; index >= 0; index -= 1) {
        const write = aligned[index]!;
        if (!write.createOwner) continue;
        const existing = existingOwnerByNode.get(write.nodeId);
        if (existing === undefined) continue;
        if (existing.submissionId === write.submissionRow.id
          && existing.outputKey === write.outputKey) {
          write.createOwner = false;
          continue;
        }
        aligned.splice(index, 1);
      }
    }

    const incomingEdges = JSON.parse(input.edges) as Array<Record<string, unknown>>;
    const nextViewport = input.viewport ? JSON.parse(input.viewport) : null;
    const currentViewport = canvasRow === null
      ? null
      : typeof canvasRow.viewport_json === "string" ? JSON.parse(canvasRow.viewport_json) : canvasRow.viewport_json ?? null;

    const unchangedPrimaryApply = canvasRow !== null && input.materials === undefined
      && aligned.length === 0
      && input.changes.length > 0 && input.changes.every((change, index) => {
        const item = itemStates[index]!;
        const owner = ownerByNode.get(item.nodeId);
        return change.action === "apply" && item.outputKey === PRIMARY_OUTPUT_KEY && item.state === "present"
          && owner?.submissionId === item.submissionRow.id && owner.outputKey === PRIMARY_OUTPUT_KEY;
      })
      && stableJson(currentViewport) === stableJson(nextViewport)
      && await canvasContentMatches(tx, pid, incomingNodes, incomingEdges);
    const saved = unchangedPrimaryApply ? canvasRow : canvasRow === null
      ? await tx.project_canvas.create({
          data: { project_id: pid, viewport_json: nextViewport, rows_authoritative: 1 },
        })
      : await tx.project_canvas.update({
          where: { id: canvasRow.id },
          data: { viewport_json: nextViewport, rows_authoritative: 1, version: { increment: 1 } },
        });

    if (!unchangedPrimaryApply) {
      try {
        await replaceCanvasRows(tx, pid, incomingNodes, incomingEdges);
      } catch (error) {
        if (error instanceof CanvasRowsWriteError) {
          throw new RecoveryContractError(
            recoveryError(400, "画布文档格式无效", RECOVERY_REASONS.invalidPayload),
          );
        }
        throw error;
      }
      if (input.materials) await linkPromptMaterials(tx, pid, input.materials as never);
      await markOutputSlotsPlaced(tx, pid, incomingNodes);
      await markAudioMixCards(tx, pid, incomingNodes, input.ownerId);
      await touchProjectEdited(tx, pid);
    }

    for (const write of [...planned, ...aligned]) {
      if (unchangedPrimaryApply) continue;
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


        await tx.generation_canvas_outputs.create({
          data: {
            generation_canvas_submission_id: write.submissionRow.id,
            output_key: write.outputKey,
            node_id: write.nodeId,
            state: write.nextState,
            revision: Math.max(1, write.nextRevision),
            ...(write.assetId !== null ? { asset_id: write.assetId } : {}),
            ...(write.slotId !== null ? { slot_id: BigInt(write.slotId) } : {}),
          },
        });
      }



      if (write.outputKey === PRIMARY_OUTPUT_KEY) {
        await tx.project_nodes.updateMany({
          where: {
            project_id: pid,
            node_id: write.submissionRow.target_node_id,
            owner_submission_id: write.submissionRow.id,
          },
          data: { owner_output_key: PRIMARY_OUTPUT_KEY, gmt_modified: new Date() },
        });
      }


      if (write.createOwner) {
        const updated = await tx.project_nodes.updateMany({
          where: { project_id: pid, node_id: write.nodeId },
          data: {
            owner_submission_id: write.submissionRow.id,
            owner_output_key: write.outputKey,
            owner_binding_revision: 1,
            gmt_modified: new Date(),
          },
        });
        if (updated.count === 0) {
          await tx.project_nodes.create({
            data: {
              project_id: pid,
              node_id: write.nodeId,
              type: "mediaNode",
              source: "user",
              is_delete: 1,
              version: 0,
              owner_submission_id: write.submissionRow.id,
              owner_output_key: write.outputKey,
              owner_binding_revision: 1,
            },
          });
        }
      }
    }

    for (let index = 0; index < input.changes.length; index += 1) {
      const write = planned[index]!;
      const owner = ownerByNode.get(write.nodeId);
      changes.push({
        recoveryItemId: input.changes[index]!.recoveryItemId,
        revision: write.nextRevision,

        nodeBindingRevision: owner ? owner.bindingRevision : write.createOwner ? 1 : 0,
        state: write.nextState,
      });
    }
    const result: CanvasRecoverySaveResult = {
      projectId: input.projectId,
      version: saved.version,
      recoveryReceipt: { commandId: input.commandId, replayed: false, changes },
    };
    await tx.project_command_receipts.create({
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




export function recoveryMarkerOfNode(node: Record<string, unknown>): Record<string, unknown> | null {
  return markerOf(node);
}







export function guardLegacyCanvasWrite(
  previous: Array<Record<string, unknown>>,
  incoming: Array<Record<string, unknown>>,
  currentOwnerKeys: ReadonlySet<string> = new Set(),
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

  const previousById = new Map(previous.map(node => [String(node.id), node]));
  for (const nodeId of previousMarkers.keys()) {
    const node = incomingById.get(nodeId) ?? reject();

    const previousMarker = previousMarkers.get(nodeId)!;
    const incomingMarker = markerOf(node);
    const stale = !currentOwnerKeys.has(`${nodeId}:${String(previousMarker.submissionId)}:${String(previousMarker.outputKey)}`);
    if (stale && incomingMarker !== null
      && currentOwnerKeys.has(`${nodeId}:${String(incomingMarker.submissionId)}:${String(incomingMarker.outputKey)}`)) continue;
    if (!protectedCardKept(previousById.get(nodeId)!, node)) reject();
  }

  for (const node of incoming) {
    const marker = markerOf(node);
    if (marker && !previousMarkers.has(String(node.id))) reject();
  }
}
