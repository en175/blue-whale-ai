import {
  findPlacement,
  SCENE_CARD_FALLBACK_HEIGHT,
  SCENE_CARD_WIDTH,
  type CostReservationSnapshot,
  type Rect,
} from "@blue-whale/core";
import type { Prisma, PrismaClient } from "@prisma/client";

import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  resolveLogicalSlots,
  type OutputSlotStatus,
} from "./generation-output-slot-repo.js";
import { appendProjectEvent } from "./product-event-repo.js";

/** 生成命令 repo（Prisma-backed）：创建/取消/重试生成任务 + 操作日志 + 点数预留。
 *  简化模型：一次任务一行（单输出语义，产出写 output_asset_ids JSON 数组）。
 *  对齐本仓 Java GenerationJobCommandService 的字段与状态语义，但不做多槽/幂等表。 */

export interface CreateJobInput {
  projectId: string;
  userId: string;
  type: "image" | "video";
  expectedOutputCount: number;
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
  /** 任务来源（generation_jobs.source）：默认 bottom_dock；视频计划应用走 plan，图片计划应用走 plan_apply。 */
  source?: string;
  /** 关联 AgentRun（图片计划应用来自冻结的 plan_message.agent_run_id）。 */
  agentRunId?: string;
  /** 关联 PlanMessage（计划应用追溯用，写入日志 payload）。 */
  planMessageId?: string;
  /** IK67HE/T14：关联 SceneCardGenerationRecord（视频路径）；输出槽会绑定此 record 用于聚合。
   *  图片路径留空（槽位仍创建，仅 job 级聚合）。 */
  sceneCardGenerationRecordId?: string;
  /** SceneCard 来源身份；用于在 job 接纳时冻结实际 Canvas 位置与尺寸。 */
  sceneCardId?: string;
  /** IK7G9X：建预留时写入 cost_reservations 的记账快照（真实预估金额 + 定价口径版本）。
   *  缺省时沿用旧行为：reserved_amount_fen=0 + 四版本 "dev"。 */
  costReservation?: CostReservationSnapshot;
}

export interface CreatedJob {
  generation_job_id: string;
  cursor: number;
}

export interface GenerationCommandRepo {
  /** 创建任务。callerTx 非空时复用调用方事务（如 plan apply 同 tx 建 job 行），
   *  否则自起 $transaction（CONTEXT：job 行可随业务事务原子创建，执行队列在提交后进入）。 */
  createJob(
    input: CreateJobInput,
    callerTx?: Prisma.TransactionClient,
  ): Promise<CreatedJob>;
  /** 软取消：置 cancel_requested_at，状态不变（worker 读到后停止）。返回是否命中可取消的任务。 */
  requestCancel(jobId: string, userId: string): Promise<boolean>;
  /** 重试失败/缺失输出槽（IK67HE/T14，spec §4.4）：复用原参数快照，只补 failed/missing 槽，
   *  不覆盖成功输出。创建新 GenerationJob（retry_of_job_id 指向原 job），expected_output_count =
   *  需补槽数。接入 command_idempotency：同 Key 同摘要重放首次结果，同 Key 异摘要判冲突。
   *  返回值带 type，供路由按 image/video 重新入队。
   *  - 重放命中（同 Key 同摘要）→ 返回既有结果；
   *  - 冲突（同 Key 异摘要）→ 返回 { kind: "idempotency_conflict" }；
   *  - 原 job 非终态 failed/partially_succeeded → null。 */
  retryJob(
    originalJobId: string,
    projectId: string,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<
    | (CreatedJob & { type: "image" | "video" })
    | { kind: "idempotency_conflict" }
    | null
  >;
  appendLog(
    jobId: string,
    event: string,
    status: string | null,
    message?: string,
    payload?: unknown,
  ): Promise<void>;
}

const SOURCE_BOTTOM_DOCK = "bottom_dock";

function validAnchor(value: unknown): value is {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.x === "number" &&
    typeof anchor.y === "number" &&
    typeof anchor.width === "number" &&
    typeof anchor.height === "number"
  );
}

async function freezePlacementAnchor(
  tx: Prisma.TransactionClient,
  input: CreateJobInput,
): Promise<Record<string, unknown>> {
  if (validAnchor(input.input.placement_anchor)) return input.input;
  const ports = tx as unknown as {
    canvas?: {
      findFirst(args: unknown): Promise<{
        viewport_json: unknown;
        nodes_json: unknown;
      } | null>;
    };
  };
  if (!ports.canvas?.findFirst) return input.input;

  const canvas = await ports.canvas.findFirst({
    where: { project_id: BigInt(input.projectId) },
    select: { viewport_json: true, nodes_json: true },
  });
  const viewport =
    canvas?.viewport_json &&
    typeof canvas.viewport_json === "object" &&
    !Array.isArray(canvas.viewport_json)
      ? (canvas.viewport_json as Record<string, unknown>)
      : {};
  const zoom =
    typeof viewport.zoom === "number" && viewport.zoom > 0 ? viewport.zoom : 1;
  let anchor = {
    x: -(typeof viewport.x === "number" ? viewport.x : 0) / zoom,
    y: -(typeof viewport.y === "number" ? viewport.y : 0) / zoom,
    width: 0,
    height: 0,
  };

  if (input.sceneCardId) {
    const nodes = Array.isArray(canvas?.nodes_json) ? canvas.nodes_json : [];
    const sceneCardNode = nodes.find((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        return false;
      }
      const candidate = node as Record<string, unknown>;
      const data =
        candidate.data &&
        typeof candidate.data === "object" &&
        !Array.isArray(candidate.data)
          ? (candidate.data as Record<string, unknown>)
          : {};
      return (
        candidate.type === "scene_card" &&
        String(candidate.scene_card_id ?? data.sceneCardId) ===
          input.sceneCardId
      );
    });
    let hasActualAnchor = false;
    if (sceneCardNode && typeof sceneCardNode === "object") {
      const node = sceneCardNode as Record<string, unknown>;
      const position = node.position;
      if (
        position &&
        typeof position === "object" &&
        !Array.isArray(position)
      ) {
        const point = position as Record<string, unknown>;
        if (typeof point.x === "number" && typeof point.y === "number") {
          anchor = {
            x: point.x,
            y: point.y,
            width:
              typeof node.width === "number" ? node.width : SCENE_CARD_WIDTH,
            height:
              typeof node.height === "number"
                ? node.height
                : SCENE_CARD_FALLBACK_HEIGHT,
          };
          hasActualAnchor = true;
        }
      }
    }
    if (!hasActualAnchor) {
      const existing: Rect[] = nodes.flatMap((candidate) => {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        ) {
          return [];
        }
        const node = candidate as Record<string, unknown>;
        const isSceneCard = node.type === "scene_card";
        const position =
          node.position &&
          typeof node.position === "object" &&
          !Array.isArray(node.position)
            ? (node.position as Record<string, unknown>)
            : {};
        return [
          {
            x: typeof position.x === "number" ? position.x : 0,
            y: typeof position.y === "number" ? position.y : 0,
            width:
              typeof node.width === "number"
                ? node.width
                : isSceneCard
                  ? SCENE_CARD_WIDTH
                  : 200,
            height:
              typeof node.height === "number"
                ? node.height
                : isSceneCard
                  ? SCENE_CARD_FALLBACK_HEIGHT
                  : 200,
          },
        ];
      });
      const position = findPlacement({
        existing,
        anchor,
        nodeWidth: SCENE_CARD_WIDTH,
        nodeHeight: SCENE_CARD_FALLBACK_HEIGHT,
      });
      anchor = {
        ...position,
        width: SCENE_CARD_WIDTH,
        height: SCENE_CARD_FALLBACK_HEIGHT,
      };
    }
  }
  return { ...input.input, placement_anchor: anchor };
}

/** cost_reservations 建行数据：真实快照或旧行为兜底（reserved=0 + 四版本 dev）。 */
function costReservationCreateData(
  reservation: CostReservationSnapshot | undefined,
  jobId: bigint,
  userId: string,
  projectId: string,
  input: CreateJobInput,
): Prisma.cost_reservationsCreateArgs["data"] {
  return {
    generation_job_id: jobId,
    user_id: BigInt(userId),
    project_id: BigInt(projectId),
    action_identity: input.actionIdentity,
    action_type: input.actionType,
    provider: "volc",
    reserved_amount_fen: reservation?.reservedAmountFen ?? 0n,
    status: "reserved",
    price_catalog_version: reservation?.priceCatalogVersion ?? "dev",
    exchange_rate_version: reservation?.exchangeRateVersion ?? "dev",
    model_policy_version: reservation?.modelPolicyVersion ?? "dev",
    cost_rule_version: reservation?.costRuleVersion ?? "dev",
  };
}

/** 在调用方事务内创建 GenerationJob + cost 预留 + 日志 + 事件（IK67H9 抽出，让计划应用可组合进更大事务）。
 *  IK67HE/T14：同时固定 expectedOutputCount 个输出槽（status=pending），槽身份与顺序稳定。
 *  surgical：行为与原 createJob 内联实现完全一致，只是把事务体上提 + 增加槽位固定。 */
export async function createJobWithinTx(
  tx: Prisma.TransactionClient,
  input: CreateJobInput,
): Promise<CreatedJob> {
  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 60 * 1000); // 30min 超时
  const frozenInput = await freezePlacementAnchor(tx, input);
  const job = await tx.generation_jobs.create({
    data: {
      project_id: BigInt(input.projectId),
      user_id: BigInt(input.userId),
      type: input.type,
      source: input.source ?? SOURCE_BOTTOM_DOCK,
      ...(input.agentRunId ? { agent_run_id: BigInt(input.agentRunId) } : {}),
      status: "queued",
      progress: 0,
      input: frozenInput as never,
      expected_output_count: input.expectedOutputCount,
      action_identity: input.actionIdentity,
      project_action_identity: input.actionIdentity,
      strategy_version:
        input.type === "video" ? "seedance-2.0-v1" : "image-sync-v1",
      execution_deadline_at: deadline,
      next_action_at: now,
      fencing_token: 0,
    },
  });
  // IK67HE/T14：固定输出槽（spec §4.4「输出槽位在首次提交时固定」）。
  if (input.expectedOutputCount > 0) {
    for (let i = 0; i < input.expectedOutputCount; i += 1) {
      await tx.generation_output_slots.create({
        data: {
          project_id: BigInt(input.projectId),
          generation_job_id: job.id,
          ...(input.sceneCardGenerationRecordId
            ? {
                scene_card_generation_record_id: BigInt(
                  input.sceneCardGenerationRecordId,
                ),
              }
            : {}),
          slot_index: i,
          status: "pending",
        },
      });
    }
  }
  await tx.cost_reservations.create({
    data: costReservationCreateData(
      input.costReservation,
      job.id,
      input.userId,
      input.projectId,
      input,
    ),
  });
  await tx.generation_job_logs.create({
    data: {
      generation_job_id: job.id,
      event: "created",
      status: "queued",
      message: "任务已创建",
      payload: {
        input,
        ...(input.planMessageId
          ? { plan_message_id: input.planMessageId }
          : {}),
      },
    } as never,
  });
  const event = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "generation_job.created",
    aggregateType: "generation_job",
    aggregateId: job.id.toString(),
    aggregateVersion: job.version,
    correlationId: input.actionIdentity,
    payload: {
      job_id: job.id.toString(),
      type: job.type,
      source: job.source,
      status: job.status,
      progress: job.progress,
      output_asset_ids: [],
    },
  });
  return {
    generation_job_id: job.id.toString(),
    cursor: Number(event.cursor),
  };
}

export function createGenerationCommandRepo(
  prisma: PrismaClient,
): GenerationCommandRepo {
  return {
    async createJob(input, callerTx) {
      // callerTx 非空：复用调用方事务（plan apply 同 tx 建 job 行）；否则自起事务。
      if (callerTx) return createJobWithinTx(callerTx, input);
      return prisma.$transaction((tx) => createJobWithinTx(tx, input), {
        maxWait: 10_000,
        timeout: 30_000,
      });
    },

    async requestCancel(jobId, userId) {
      // 仅归属当前用户的 queued/processing 任务可取消。
      const job = await prisma.generation_jobs.findFirst({
        where: { id: BigInt(jobId), user_id: BigInt(userId), is_delete: false },
        select: { id: true, status: true },
      });
      if (!job || (job.status !== "queued" && job.status !== "processing"))
        return false;
      await prisma.generation_jobs.update({
        where: { id: BigInt(jobId) },
        data: { cancel_requested_at: new Date() },
      });
      await this.appendLog(
        jobId,
        "cancel_requested",
        job.status,
        "用户请求取消",
      );
      return true;
    },

    retryJob(originalJobId, projectId, userId, idempotencyKey, requestHash) {
      return transactionWithUniqueRetry(prisma, async (tx) => {
        const pid = BigInt(projectId);
        const original = await tx.generation_jobs.findFirst({
          where: {
            id: BigInt(originalJobId),
            project_id: pid,
            user_id: BigInt(userId),
            is_delete: false,
          },
        });
        if (!original) return null;
        if (
          original.status !== "failed" &&
          original.status !== "partially_succeeded"
        ) {
          return null;
        }

        // IK7G9X：重试复用原 job 的记账快照（同一任务的重试，定价口径不变）。
        const originalReservation = await tx.cost_reservations.findFirst({
          where: { generation_job_id: original.id },
        });

        const operation = "generation.retry";
        const existing = idempotencyKey
          ? await tx.command_idempotency.findUnique({
              where: {
                project_id_operation_idempotency_key: {
                  project_id: pid,
                  operation,
                  idempotency_key: idempotencyKey,
                },
              },
              select: {
                request_hash: true,
                generation_job_id: true,
                accepted_cursor: true,
              },
            })
          : null;
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          return {
            generation_job_id: String(existing.generation_job_id),
            cursor: Number(existing.accepted_cursor),
            type: original.type as "image" | "video",
          };
        }

        const allProjectSlots = await tx.generation_output_slots.findMany({
          where: { project_id: pid },
          orderBy: { id: "asc" },
        });
        const originalSlotIds = new Set(
          allProjectSlots
            .filter((slot) => slot.generation_job_id === original.id)
            .map((slot) => slot.id),
        );
        const retrySlotsByParent = new Map<
          bigint,
          Array<(typeof allProjectSlots)[number]>
        >();
        for (const slot of allProjectSlots) {
          if (slot.retry_of_slot_id === null) continue;
          const children = retrySlotsByParent.get(slot.retry_of_slot_id) ?? [];
          children.push(slot);
          retrySlotsByParent.set(slot.retry_of_slot_id, children);
        }
        const chainSlotIds = new Set(originalSlotIds);
        const pendingParents = [...originalSlotIds];
        for (let index = 0; index < pendingParents.length; index += 1) {
          for (const child of retrySlotsByParent.get(pendingParents[index]!) ??
            []) {
            if (!chainSlotIds.has(child.id)) {
              chainSlotIds.add(child.id);
              pendingParents.push(child.id);
            }
          }
        }
        const trackedSlots = allProjectSlots.filter((slot) =>
          chainSlotIds.has(slot.id),
        );
        const failedSlots = resolveLogicalSlots(
          trackedSlots.map((slot) => ({
            ...slot,
            status: slot.status as OutputSlotStatus,
          })),
        ).filter(
          (slot) => slot.status === "failed" || slot.status === "missing",
        );
        if (originalSlotIds.size > 0 && failedSlots.length === 0) return null;
        const retryCount =
          originalSlotIds.size > 0
            ? failedSlots.length
            : (original.expected_output_count ?? 1);
        const now = new Date();
        const deadline = new Date(now.getTime() + 30 * 60 * 1000);
        const retry = await tx.generation_jobs.create({
          data: {
            project_id: pid,
            user_id: original.user_id,
            type: original.type,
            source: original.source,
            status: "queued",
            progress: 0,
            input: original.input as never,
            expected_output_count: retryCount,
            retry_of_job_id: original.id,
            action_identity: idempotencyKey || `retry:${originalJobId}`,
            project_action_identity: idempotencyKey || `retry:${originalJobId}`,
            strategy_version:
              original.strategy_version ??
              (original.type === "video" ? "seedance-2.0-v1" : "image-sync-v1"),
            execution_deadline_at: deadline,
            next_action_at: now,
            fencing_token: 0,
          },
        });
        // IK7G9X：为重试 job 补 cost_reservations 行（复用原 job 的金额与版本口径）。
        const retryInput: CreateJobInput = {
          projectId,
          userId: original.user_id.toString(),
          type: original.type as "image" | "video",
          expectedOutputCount: retryCount,
          input: (original.input ?? {}) as Record<string, unknown>,
          actionIdentity: idempotencyKey || `retry:${originalJobId}`,
          actionType:
            original.type === "video" ? "generate_video" : "generate_image",
        };
        await tx.cost_reservations.create({
          data: costReservationCreateData(
            originalReservation
              ? {
                  reservedAmountFen:
                    originalReservation.reserved_amount_fen ?? 0n,
                  priceCatalogVersion:
                    originalReservation.price_catalog_version,
                  exchangeRateVersion:
                    originalReservation.exchange_rate_version,
                  modelPolicyVersion:
                    originalReservation.model_policy_version,
                  costRuleVersion: originalReservation.cost_rule_version,
                }
              : undefined,
            retry.id,
            original.user_id.toString(),
            projectId,
            retryInput,
          ),
        });
        // 为重试 job 创建新槽，链 retry_of_slot_id 指向被补的原始槽。
        if (failedSlots.length > 0) {
          const recordIds = new Set<bigint>();
          for (const orig of failedSlots) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                ...(orig.scene_card_generation_record_id
                  ? {
                      scene_card_generation_record_id:
                        orig.scene_card_generation_record_id,
                    }
                  : {}),
                slot_index: orig.slot_index,
                status: "pending",
                retry_of_slot_id: orig.id,
              },
            });
            if (orig.scene_card_generation_record_id) {
              recordIds.add(orig.scene_card_generation_record_id);
            }
          }
          for (const recordId of recordIds) {
            const record = await tx.scene_card_generation_records.update({
              where: { id: recordId },
              data: {
                summary_status: "generating",
                version: { increment: 1 },
              },
            });
            await appendProjectEvent(tx, {
              projectId: record.project_id.toString(),
              eventType: "scene_card_generation_record.summary_changed",
              aggregateType: "scene_card_generation_record",
              aggregateId: recordId.toString(),
              aggregateVersion: record.version,
              correlationId: `record_${recordId.toString()}`,
              payload: {
                record_id: recordId.toString(),
                summary_status: "generating",
              },
            });
          }
        } else {
          // 早于 T14 的 job 无槽位：退化为按 expected_output_count 建槽（向后兼容）。
          for (let i = 0; i < retryCount; i += 1) {
            await tx.generation_output_slots.create({
              data: {
                project_id: pid,
                generation_job_id: retry.id,
                slot_index: i,
                status: "pending",
              },
            });
          }
        }
        const event = await appendProjectEvent(tx, {
          projectId,
          eventType: "generation_job.created",
          aggregateType: "generation_job",
          aggregateId: retry.id.toString(),
          aggregateVersion: retry.version,
          correlationId: idempotencyKey || `retry:${originalJobId}`,
          payload: {
            job_id: retry.id.toString(),
            type: retry.type,
            source: retry.source,
            status: retry.status,
            progress: retry.progress,
            output_asset_ids: [],
            retry_of_job_id: originalJobId,
          },
        });
        if (idempotencyKey) {
          await tx.command_idempotency.create({
            data: {
              project_id: pid,
              operation,
              idempotency_key: idempotencyKey,
              request_hash: requestHash,
              generation_job_id: retry.id,
              resource_id: BigInt(originalJobId),
              accepted_cursor: BigInt(event.cursor),
            },
          });
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: retry.id,
            event: "retry_created",
            status: "queued",
            message: `重试 ${originalJobId}`,
          },
        });
        return {
          generation_job_id: retry.id.toString(),
          cursor: Number(event.cursor),
          type: original.type as "image" | "video",
        };
      });
    },

    async appendLog(jobId, event, status, message, payload) {
      const data: Record<string, unknown> = {
        generation_job_id: BigInt(jobId),
        event,
        status,
      };
      if (message !== undefined) data.message = message;
      if (payload !== undefined) data.payload = payload as never;
      await prisma.generation_job_logs.create({ data: data as never });
    },
  };
}
