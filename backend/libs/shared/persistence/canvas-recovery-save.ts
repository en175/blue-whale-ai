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
  parseRecoveryItemId,
  recoveryError,
} from "@lib/contracts";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { linkPromptMaterials, markAudioMixCards, markOutputSlotsPlaced } from "./canvas-repo.js";
import { RecoveryContractError } from "./generation-canvas-recovery-repo.js";
import {
  isMultiResultOutputKey,
  outputNodeIdForKey,
  parseAssetIds,
  projectVirtualOutputs,
  type VirtualOutputItem,
  type VirtualOutputProjection,
} from "./canvas-recovery-multi-output.js";

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

/** 事务锁内读到的画布 previous 文档（Json 列兼容解析；无画布/空文档返回空数组）。 */
function parsePreviousNodes(raw: unknown): Array<Record<string, unknown>> {
  if (raw === null || raw === undefined) return [];
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
}

function markerMatches(marker: Record<string, unknown> | null, submissionId: string, outputKey: string): boolean {
  return marker !== null
    && marker.protocolVersion === CANVAS_RECOVERY_PROTOCOL_VERSION
    && marker.submissionId === submissionId
    && marker.outputKey === outputKey;
}

/** 单个恢复项的当前状态（$target 读 submission 行，其余读 outputs 行；无行=pending/0）。
 *  IKJJQY：nodeId 为该项的规范节点身份——持久输出读行、虚拟输出按 output_key 推导
 *  （$target/primary=目标节点；slot:<id>=generation-output:<id>；segment/track=generation-result 形态）。 */
interface ItemState {
  submissionRow: { id: bigint; submission_id: string; target_node_id: string; generation_job_id: bigint; target_state: string; target_revision: number; recovery_seed: unknown };
  outputKey: string;
  state: string;
  revision: number;
  outputRowId: bigint | null;
  nodeId: string;
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
        // 持久行读行上的 node_id（首次落行写入后不再变）；虚拟输出按规范推导（计算恒等，B.4）。
        nodeId = output ? output.node_id : outputNodeIdForKey(outputKey, {
          submissionId: submissionRow.submission_id,
          targetNodeId: submissionRow.target_node_id,
        });
      }
      itemStates.push({ submissionRow, outputKey, state, revision, outputRowId, nodeId });
    }
    // 锁定读取当前关联（B.6 步骤 2-3）：节点归属行按 node_id 排序 FOR UPDATE——
    // restore/settleTarget/replaceTarget 的「归属未交给另一项」判定必须在锁内成立，
    // 否则并发接管会让校验基于过期快照通过。IKJJQY：锁集扩展到全部涉及项的规范节点
    // （多结果输出的 apply/remove 首次建立 owner 也要在锁内判占用）。
    const involvedNodes = [...new Set(itemStates.map(item => item.nodeId))].sort();
    const ownerRows = involvedNodes.length > 0
      ? await tx.$queryRaw<
        Array<{ node_id: string; generation_canvas_submission_id: bigint; output_key: string; binding_revision: number }>
      >`SELECT node_id, generation_canvas_submission_id, output_key, binding_revision
      FROM generation_canvas_node_owners WHERE project_id = ${pid}
      AND node_id IN (${Prisma.join(involvedNodes)}) FOR UPDATE`
      : [];
    const ownerByNode = new Map(ownerRows.map(owner => [owner.node_id, owner]));
    const changes: CanvasRecoveryReceiptChange[] = [];
    // IKJJQY：可信终态投影缓存（同提交多次动作/扇出校验只查一次；锁内读，无 TOCTOU）。
    // IKJLTS：连同 job 行一并缓存——primary 的可信产物资产取任务产物清单（output_asset_ids）。
    const projectionCache = new Map<string, { projection: VirtualOutputProjection; job: { output_asset_ids: unknown } | null }>();
    const projectionOf = async (submissionRow: NonNullable<ItemState["submissionRow"]>): Promise<{ projection: VirtualOutputProjection; job: { output_asset_ids: unknown } | null }> => {
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
    /** 虚拟输出（无行）的 apply/remove：键必须在投影集内（防伪造键/漏投影；B.4 规范身份）。 */
    const assertVirtualKeyProjected = async (item: ItemState): Promise<VirtualOutputItem | null> => {
      if (item.outputRowId !== null) return null;
      const { projection } = await projectionOf(item.submissionRow);
      if (projection.kind === "invalid") {
        throw new RecoveryContractError(
          recoveryError(422, "服务端无法得到无歧义输出映射", RECOVERY_REASONS.projectionInvalid),
        );
      }
      const virtual = projection.items.find(candidate => candidate.outputKey === item.outputKey) ?? null;
      if (virtual === null) {
        throw new RecoveryContractError(
          recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
        );
      }
      return virtual;
    };
    /** IKJLTS（PR981-REVIEW2-R2）：输出项的可信产物资产——primary 取任务产物清单唯一资产
     *  （QU 一对一），多结果取投影项资产；无法证明来源返回 null（调用方拒绝）。 */
    const trustedAssetOf = async (item: ItemState): Promise<string | null> => {
      const { projection, job } = await projectionOf(item.submissionRow);
      if (projection.kind === "invalid") {
        throw new RecoveryContractError(
          recoveryError(422, "服务端无法得到无歧义输出映射", RECOVERY_REASONS.projectionInvalid),
        );
      }
      if (item.outputKey === PRIMARY_OUTPUT_KEY) {
        const assets = parseAssetIds(job?.output_asset_ids);
        return assets !== null && assets.length === 1 ? assets[0]! : null;
      }
      return projection.items.find(candidate => candidate.outputKey === item.outputKey)?.assetId ?? null;
    };
    /** IKJLTS（PR981-REVIEW2-R2 / B.2/B.6）：显式 apply/restore 的结果卡资产必须等于该项
     *  可信产物——客户端自报的 assetId 不得记成生成结果；不同资产、缺资产或来源无法
     *  证明时 422 整笔拒绝（画布/恢复项/归属/回执零部分写入）。$target 占位无产物，豁免。 */
    const assertTrustedResultAsset = async (item: ItemState, node: Record<string, unknown> | undefined): Promise<void> => {
      const trusted = await trustedAssetOf(item);
      const declared = (node?.data as Record<string, unknown> | undefined)?.assetId ?? null;
      if (trusted === null || declared === null || String(declared) !== trusted) {
        throw new RecoveryContractError(
          recoveryError(422, "结果资产与任务可信产物不一致", RECOVERY_REASONS.documentMismatch),
        );
      }
    };
    // 逐动作校验 + 生成写入计划（写入延后到画布写成功之后，整笔原子）。
    interface PlannedWrite {
      kind: "targetState" | "outputUpsert" | "ownerSwitch";
      submissionRow: NonNullable<ItemState["submissionRow"]>;
      outputKey: string;
      nextState: string;
      nextRevision: number;
      outputRowId: bigint | null;
      /** 该项的规范节点（target 或输出身份；落行 node_id / owner 建立 / 回执用）。 */
      nodeId: string;
      /** 虚拟多结果输出首次落行时携带的投影槽位引用（slot: 家族；其余 null）。 */
      slotId: string | null;
      /** 首次建立节点归属（虚拟输出 apply/remove）：写入段建 owner 行，回执版本为 1。 */
      createOwner: boolean;
    }
    const planned: PlannedWrite[] = [];
    for (let index = 0; index < input.changes.length; index += 1) {
      const change = input.changes[index]!;
      const item = itemStates[index]!;
      const node = incomingByNode.get(item.nodeId);
      const marker = markerOf(node);
      const owner = ownerByNode.get(item.nodeId);
      const owned = owner !== undefined && owner.generation_canvas_submission_id === item.submissionRow.id
        && owner.output_key === item.outputKey;
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
        nodeId: item.nodeId,
        slotId: null,
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
          // IKJLTS：显式 apply 的结果卡资产核对（虚拟与已持久输出一致；$target 占位豁免）。
          if (item.outputKey !== TARGET_OUTPUT_KEY) {
            await assertTrustedResultAsset(item, node);
          }
          // 虚拟输出首次 apply：键必须在投影集内；节点未被其他提交占用（不静默覆盖）。
          let slotId: string | null = null;
          if (item.outputRowId === null && item.outputKey !== TARGET_OUTPUT_KEY) {
            const virtual = await assertVirtualKeyProjected(item);
            slotId = virtual?.slotId ?? null;
            if (isMultiResultOutputKey(item.outputKey) && owner !== undefined && !owned) {
              throw new RecoveryContractError(
                recoveryError(422, "结果节点已被其他提交占用", RECOVERY_REASONS.documentMismatch),
              );
            }
          }
          // 同状态且身份一致的重复 apply 是无副作用成功，不增加 revision（B.6）。
          if (item.state === "present") planned.push({ ...plan("present"), nextRevision: item.revision, slotId });
          else {
            const write = plan("present");
            planned.push({
              ...write, slotId,
              // 多结果虚拟输出首次 apply 建立节点归属（owner 行随本保存事务创建，B.6）。
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
            // B.6：运行中目标不能绕过取消被删（占位删除须以取消确认为前提）；
            // 抢先成功仍停止删除——成功产物的收口走 replaceTarget 转换，不删目标。
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
              // 一对一 primary 首次 remove 必须与 replaceTarget 配套（B.6：owner 从 $target 交给 primary）。
              const paired = input.changes.some(other =>
                other.action === "replaceTarget"
                && parseRecoveryItemId(other.recoveryItemId)?.submissionId === item.submissionRow.submission_id);
              if (!paired) {
                throw new RecoveryContractError(
                  recoveryError(422, "恢复动作与画布文档不一致", RECOVERY_REASONS.documentMismatch),
                );
              }
            } else {
              // 多结果虚拟输出首次 remove：独立合法（看到结果后、首次保存前明确删掉某项），
              // 键必须在投影集内；同事务建输出删除记录 + 节点 owner（B.6，不留下无 owner 记录）。
              await assertVirtualKeyProjected(item);
              if (owner !== undefined && !owned) {
                throw new RecoveryContractError(
                  recoveryError(422, "结果节点已被其他提交占用", RECOVERY_REASONS.documentMismatch),
                );
              }
              planned.push({ ...plan("removed"), createOwner: true });
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
          // IKJLTS：restore 回到画布的结果卡同样核对可信产物（$target 占位豁免）。
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
          // IKJJQY（B.6）：占位转换与全部未决输出同一笔保存完成——不能只删占位遗漏结果。
          // 投影歧义（重复键/缺产物/归属无法证明）拒绝转换，保留占位，不重发（B.8）。
          const { projection } = await projectionOf(item.submissionRow);
          if (projection.kind === "invalid") {
            throw new RecoveryContractError(
              recoveryError(422, "服务端无法得到无歧义输出映射", RECOVERY_REASONS.projectionInvalid),
            );
          }
          const persistedKeys = new Set(
            (await tx.generation_canvas_outputs.findMany({
              where: { generation_canvas_submission_id: item.submissionRow.id },
              select: { output_key: true },
            })).map(output => output.output_key),
          );
          for (const virtual of projection.items) {
            if (persistedKeys.has(virtual.outputKey)) continue;
            const handled = input.changes.some(other => {
              const ids = parseRecoveryItemId(other.recoveryItemId);
              return ids?.submissionId === item.submissionRow.submission_id
                && ids.outputKey === virtual.outputKey
                && (other.action === "apply" || other.action === "remove");
            });
            if (!handled) {
              throw new RecoveryContractError(
                recoveryError(422, "占位转换必须与全部结果同笔保存，不能只删占位遗漏结果", RECOVERY_REASONS.documentMismatch),
              );
            }
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
    // ── IKJKU2（PR981-REVIEW-20261003-F3）：未声明受保护项核对 ──
    // 逐动作校验只覆盖显式声明项；此前「合法变更 B 的保存顺带省略/剥除/改绑已入库的
    // 受保护卡 A」会静默覆盖全文落库，恢复状态与文档脱节（违反 B.6/B.7）。基准与
    // guardLegacyCanvasWrite 同款：previous 文档中带标记的卡必须在提交文档中原样保持
    // （在场、标记身份、承接类型、结果资产），叠加两项豁免——已声明显式动作的项交由
    // 逐动作校验；服务端已 removed 的项文档缺席是合法终态。
    const declaredKeys = new Set(itemStates.map(item => `${item.submissionRow.submission_id}:${item.outputKey}`));
    const previousNodes = parsePreviousNodes(canvasRow?.nodes_json);
    const undeclaredAbsent: Array<{ submissionId: string; outputKey: string }> = [];
    for (const previousNode of previousNodes) {
      const marker = markerOf(previousNode);
      if (!marker) continue;
      const submissionId = String(marker.submissionId);
      const outputKey = String(marker.outputKey);
      if (declaredKeys.has(`${submissionId}:${outputKey}`)) continue;
      const node = incomingByNode.get(String(previousNode.id));
      if (node === undefined) {
        undeclaredAbsent.push({ submissionId, outputKey });
        continue;
      }
      const tampered = () => new RecoveryContractError(
        recoveryError(422, "未声明的受保护项被改动，须以显式恢复动作变更", RECOVERY_REASONS.documentMismatch),
      );
      if (!markerMatches(markerOf(node), submissionId, outputKey)) throw tampered();
      if ((previousNode.type ?? null) !== (node.type ?? null)) throw tampered();
      const previousAsset = (previousNode.data as Record<string, unknown> | undefined)?.assetId ?? null;
      const nextAsset = (node.data as Record<string, unknown> | undefined)?.assetId ?? null;
      if (previousAsset !== null && previousAsset !== nextAsset) throw tampered();
    }
    // 未声明缺席项以服务端可信状态联判（提交/输出记录，不信客户端自报）：仅服务端已
    // removed 的缺席合法；提交记录不存在也不豁免。canvas 行锁内普通读即可——所有写
    // 这些行的路径（受理/本保存）锁序均为 project → canvas → 归属行。
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
        // IKJJQY：node_id 用该项规范身份（多结果输出不再挂目标节点），slot 家族带槽位引用。
        await tx.generation_canvas_outputs.create({
          data: {
            generation_canvas_submission_id: write.submissionRow.id,
            output_key: write.outputKey,
            node_id: write.nodeId,
            state: write.nextState,
            revision: Math.max(1, write.nextRevision),
            ...(write.slotId !== null ? { slot_id: BigInt(write.slotId) } : {}),
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
      // IKJJQY：虚拟多结果输出首次 apply/remove 同事务建立节点归属（版本从 1 起且继续保留，
      // 供显式撤销核对；不留下无 owner 的删除记录）。并发抢占由 (project_id, node_id) 唯一约束兜底回滚。
      if (write.createOwner) {
        await tx.generation_canvas_node_owners.create({
          data: {
            project_id: pid,
            node_id: write.nodeId,
            generation_canvas_submission_id: write.submissionRow.id,
            output_key: write.outputKey,
            binding_revision: 1,
          },
        });
      }
    }
    // ── 紧凑回执 ──
    for (let index = 0; index < input.changes.length; index += 1) {
      const write = planned[index]!;
      const owner = ownerByNode.get(write.nodeId);
      changes.push({
        recoveryItemId: input.changes[index]!.recoveryItemId,
        revision: write.nextRevision,
        // 首次建立的归属行版本为 1；owner 从 $target 切到 primary 不推进版本（沿用现值）。
        nodeBindingRevision: owner ? Number(owner.binding_revision) : write.createOwner ? 1 : 0,
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
