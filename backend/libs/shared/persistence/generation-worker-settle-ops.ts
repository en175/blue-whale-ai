// IK74V8：从 generation-worker-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 作业结算：完成、失败、额度结算与作业日志追加。
// IK7GRP：completeJob / failJob / settleReservation 加 lease_owner + fencing_token
// 守卫（镜像视频 publishVideoResult / failVideoJob 的 updateMany CAS + 同事务后写模式），
// stale worker 的迟到写入被拒且不产生任何副作用（槽位、事件、素材、预留、汇总回写）。
import type {Prisma, PrismaClient} from "@prisma/client";

import {appendProjectEvent} from "./product-event-repo.js";
import {syncRecordSummary, syncStoryboardPreviewSummary} from "./generation-worker-internals.js";
import type {WorkerRepo} from "./generation-worker-types.js";

/** 守卫条件：job 必须仍由当前 worker 持有 processing 态且 fencing_token 一致。 */
function fenceWhere(input: {jobId: string; workerId: string; fencingToken: number}) {
  return {
    id: BigInt(input.jobId),
    status: "processing" as const,
    lease_owner: input.workerId,
    fencing_token: BigInt(input.fencingToken),
  };
}

/** IK7G9X：事务内释放预留（reserved → released，实扣 0）。仅调处于终态失败/取消的 job。
 *  IK9VZ0：releaseNote 记录退款校验结果（refund_confirmed / refund_unverified），缺省不写。 */
async function releaseReservationInTx(
  tx: Prisma.TransactionClient,
  jobId: string,
  releaseNote?: string,
): Promise<void> {
  await tx.cost_reservations.updateMany({
    where: { generation_job_id: BigInt(jobId), status: "reserved" },
    data: {
      status: "released",
      actual_amount_fen: 0n,
      ...(releaseNote ? { release_note: releaseNote } : {}),
    },
  });
}

/** IK7G9X：事务内结算预留（reserved → settled，写实扣金额）。 */
async function settleReservationInTx(
  tx: Prisma.TransactionClient,
  jobId: string,
  actualAmountFen: bigint,
): Promise<void> {
  await tx.cost_reservations.updateMany({
    where: { generation_job_id: BigInt(jobId), status: "reserved" },
    data: { status: "settled", actual_amount_fen: actualAmountFen },
  });
}

/** completeJob 事务体（IK7GRP 守卫 CAS → 槽位 → 事件 → 汇总回写）。
 *  供 completeJob 与 completeJobAndSettle 复用（IK9VZ0：图片结算原子化）。 */
async function completeJobInTx(
  tx: Prisma.TransactionClient,
  input: {
    jobId: string;
    assetIds: string[];
    workerId: string;
    fencingToken: number;
  },
): Promise<boolean> {
  // IK7GRP：守卫更新——CAS 把 processing → finalStatus（先占位 succeeded，按槽位聚合后修正）。
  // 守卫不通过（count≠1）立即返回，后续槽位/事件/汇总回写均不执行。
  const {jobId, assetIds, workerId, fencingToken} = input;
  const guarded = await tx.generation_jobs.updateMany({
    where: fenceWhere({jobId, workerId, fencingToken}),
    data: {
      status: "succeeded",
      progress: 100,
      output_asset_ids: assetIds.map((id) => Number(id)),
      next_action_at: null,
      lease_owner: null,
      lease_expires_at: null,
      version: {increment: 1},
    },
  });
  if (guarded.count !== 1) return false;
  // IK67HE/T14：同步输出槽状态——成功 asset 绑定对应 slot_index；缺失槽标 failed。
  const slots = await tx.generation_output_slots.findMany({
    where: { generation_job_id: BigInt(jobId) },
    orderBy: { slot_index: "asc" },
  });
  let finalStatus = "succeeded";
  if (slots.length > 0) {
    for (const [i, assetId] of assetIds.entries()) {
      const slot = slots[i];
      if (slot) {
        await tx.generation_output_slots.update({
          where: { id: slot.id },
          data: { status: "succeeded", asset_id: BigInt(assetId) },
        });
      }
    }
    // 未匹配到成功 asset 的剩余槽标 failed。
    for (let i = assetIds.length; i < slots.length; i += 1) {
      const slot = slots[i];
      if (!slot) continue;
      await tx.generation_output_slots.update({
        where: { id: slot.id },
        data: { status: "failed" },
      });
    }
    // 聚合 job 状态（全部成功→succeeded；部分→partially_succeeded；全失败→failed）。
    const statuses = slots.map((s, i) =>
      i < assetIds.length ? "succeeded" : "failed",
    );
    if (statuses.every((s) => s === "succeeded")) {
      finalStatus = "succeeded";
    } else if (statuses.some((s) => s === "succeeded")) {
      finalStatus = "partially_succeeded";
    } else {
      finalStatus = "failed";
    }
  }
  // 聚合态与守卫占位不同时再修正（partially_succeeded / failed）。
  if (finalStatus !== "succeeded") {
    await tx.generation_jobs.update({
      where: { id: BigInt(jobId) },
      data: { status: finalStatus },
    });
  }
  const job = await tx.generation_jobs.findUnique({
    where: { id: BigInt(jobId) },
  });
  // 守卫 CAS 刚成功，同事务内该行必存在；不存在即数据损坏——抛错回滚整个事务，
  // 不得返回 false（状态与槽位写入已发生，false 会被调用方误读为「守卫拒绝」）。
  if (!job) {
    throw new Error(`completeJob 守卫通过后任务 ${jobId} 不存在，数据损坏`);
  }
  if (job.project_id === null) return true;
  await appendProjectEvent(tx, {
    projectId: job.project_id.toString(),
    eventType: "generation_job.status_changed",
    aggregateType: "generation_job",
    aggregateId: job.id.toString(),
    aggregateVersion: job.version,
    correlationId: `job_${job.id.toString()}`,
    payload: {
      job_id: job.id.toString(),
      type: job.type,
      source: job.source,
      status: job.status,
      progress: job.progress,
      output_asset_ids: assetIds,
    },
  });
  for (const [index, assetId] of assetIds.entries()) {
    const slot = slots[index];
    const slotIndex = slot?.slot_index ?? index;
    await appendProjectEvent(tx, {
      projectId: job.project_id.toString(),
      eventType: "generation_job.output_attached",
      aggregateType: "generation_job_output",
      aggregateId: `${job.id.toString()}:${slotIndex}`,
      aggregateVersion: 0,
      correlationId: `job_${job.id.toString()}`,
      payload: {
        job_id: job.id.toString(),
        slot_id: slot?.id.toString() ?? null,
        slot_index: slotIndex,
        status: "succeeded",
        asset_id: assetId,
        retry_of_slot_id:
          slot?.retry_of_slot_id == null
            ? null
            : slot.retry_of_slot_id.toString(),
        initial_placement_status: "pending",
      },
    });
  }
  for (let index = assetIds.length; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot) continue;
    await appendProjectEvent(tx, {
      projectId: job.project_id.toString(),
      eventType: "generation_job.output_updated",
      aggregateType: "generation_job_output",
      aggregateId: `${job.id.toString()}:${slot.slot_index}`,
      aggregateVersion: 0,
      correlationId: `job_${job.id.toString()}`,
      payload: {
        job_id: job.id.toString(),
        slot_id: slot.id.toString(),
        slot_index: slot.slot_index,
        status: "failed",
        asset_id: null,
        retry_of_slot_id:
          slot.retry_of_slot_id == null
            ? null
            : slot.retry_of_slot_id.toString(),
        initial_placement_status: "pending",
      },
    });
  }
  // 回写关联的 SceneCardGenerationRecord.summary_status（视频路径）。
  const firstSlot = slots[0];
  if (firstSlot?.scene_card_generation_record_id) {
    await syncRecordSummary(
      tx,
      firstSlot.scene_card_generation_record_id,
    );
  }
  // 回写 StoryboardPreview.summary_status（图片路径，IK67HF/T15）。
  await syncStoryboardPreviewSummary(tx, job.id);
  return true;
}

export function createWorkerSettleOps(prisma: PrismaClient): Pick<WorkerRepo, "completeJob" | "completeJobAndSettle" | "failJob" | "settleReservation" | "appendLog"> {
  return {
    async completeJob(input) {
      return prisma.$transaction(async (tx) => completeJobInTx(tx, input));
    },

    /** IK9VZ0：图片结算原子化——completeJob 与 settleReservation 合并单事务。
     *  中间任何一步抛错整事务回滚：job 不会出现「已 succeeded 但预留仍 reserved」的账不平。
     *  视频 publishVideoResult 本就是同事务，无需此入口；此处为图片/音频 finishJob 使用。 */
    async completeJobAndSettle(input: {
      jobId: string;
      assetIds: string[];
      workerId: string;
      fencingToken: number;
      actualAmountFen?: bigint;
    }): Promise<boolean> {
      return prisma.$transaction(async (tx) => {
        const completed = await completeJobInTx(tx, input);
        if (!completed) return false;
        // 结算预留（reserved → settled + 实扣金额；缺省 0 = 旧行为）。
        await settleReservationInTx(tx, input.jobId, input.actualAmountFen ?? 0n);
        return true;
      });
    },

    async failJob(input) {
      return prisma.$transaction(async (tx) => {
        // IK7GRP：守卫更新——CAS 把 processing → failed。守卫不通过（count≠1）立即返回，
        // succeeded 任务不会被迟到的 failJob 翻为 failed，后续槽位/事件/汇总回写均不执行。
        const {jobId, errorCode, errorMessage, workerId, fencingToken} = input;
        const guarded = await tx.generation_jobs.updateMany({
          where: fenceWhere({jobId, workerId, fencingToken}),
          data: {
            status: "failed",
            error: {
              code: errorCode,
              message: errorMessage,
              ...(input.details !== undefined ? { details: input.details } : {}),
            } as never,
            next_action_at: null,
            lease_owner: null,
            lease_expires_at: null,
            version: { increment: 1 },
          },
        });
        if (guarded.count !== 1) return false;
        // IK67HE/T14：失败时把该 job 的全部 pending 槽标 failed。
        const slots = await tx.generation_output_slots.findMany({
          where: { generation_job_id: BigInt(jobId), status: "pending" },
        });
        for (const slot of slots) {
          await tx.generation_output_slots.update({
            where: { id: slot.id },
            data: { status: "failed" },
          });
        }
        const job = await tx.generation_jobs.findUnique({
          where: { id: BigInt(jobId) },
        });
        // 与 completeJob 同理：守卫 CAS 刚成功，同事务内该行必存在；不存在即数据损坏——
        // 抛错回滚整个事务，不得返回 false（副作用已写入，false 会被误读为「守卫拒绝」）。
        if (!job) {
          throw new Error(`failJob 守卫通过后任务 ${jobId} 不存在，数据损坏`);
        }
        await tx.generation_job_logs.create({
          data: {
            generation_job_id: job.id,
            event: "failed",
            status: "failed",
            message: `${errorCode}: ${errorMessage}`,
          },
        });
        if (job.project_id !== null) {
          await appendProjectEvent(tx, {
            projectId: job.project_id.toString(),
            eventType: "generation_job.status_changed",
            aggregateType: "generation_job",
            aggregateId: job.id.toString(),
            aggregateVersion: job.version,
            correlationId: `job_${job.id.toString()}`,
            payload: {
              job_id: job.id.toString(),
              type: job.type,
              source: job.source,
              status: job.status,
              progress: job.progress,
              error: { code: errorCode, message: errorMessage },
            },
          });
          for (const slot of slots) {
            await appendProjectEvent(tx, {
              projectId: job.project_id.toString(),
              eventType: "generation_job.output_updated",
              aggregateType: "generation_job_output",
              aggregateId: `${job.id.toString()}:${slot.slot_index}`,
              aggregateVersion: 0,
              correlationId: `job_${job.id.toString()}`,
              payload: {
                job_id: job.id.toString(),
                slot_id: slot.id.toString(),
                slot_index: slot.slot_index,
                status: "failed",
                asset_id: null,
                retry_of_slot_id:
                  slot.retry_of_slot_id == null
                    ? null
                    : slot.retry_of_slot_id.toString(),
                initial_placement_status: "pending",
                error: { code: errorCode, message: errorMessage },
              },
            });
          }
        }
        // 回写关联的 SceneCardGenerationRecord.summary_status（视频路径）。
        const firstSlot = slots[0];
        if (firstSlot?.scene_card_generation_record_id) {
          await syncRecordSummary(
            tx,
            firstSlot.scene_card_generation_record_id,
          );
        }
        // 回写 StoryboardPreview.summary_status（图片路径，IK67HF/T15）。
        await syncStoryboardPreviewSummary(tx, job.id);
        // IK7G9X：失败即释放预留（reserved → released，实扣 0）。
        // IK9VZ0：releaseNote 记录退款校验结果（refund_confirmed / refund_unverified）。
        await releaseReservationInTx(tx, jobId, input.releaseNote);
        return true;
      });
    },

    async settleReservation(input) {
      // IK7GRP：只在守卫通过的事务内结算。settleReservation 紧跟 completeJob，
      // job 已是终态（completeJob 已清 lease、置 succeeded/partially_succeeded/failed），
      // 故守卫条件校验「本次完成发放的 fencing_token 仍匹配」+ 终态，而非 processing+lease。
      // 用 CAS（version 自增）做原子占位，与 completeJob/failJob 同构，消除 read-check-then-write 竞态。
      // IK7G9X：actualAmountFen 缺省 0（旧行为）；传入真实扣费时写真实值。
      return prisma.$transaction(async (tx) => {
        const owned = await tx.generation_jobs.updateMany({
          where: {
            id: BigInt(input.jobId),
            status: { in: ["succeeded", "partially_succeeded", "failed"] },
            fencing_token: BigInt(input.fencingToken),
          },
          data: { version: { increment: 1 } },
        });
        if (owned.count !== 1) return false;
        await tx.cost_reservations.updateMany({
          where: { generation_job_id: BigInt(input.jobId), status: "reserved" },
          data: {
            status: "settled",
            actual_amount_fen: input.actualAmountFen ?? 0n,
          },
        });
        return true;
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
