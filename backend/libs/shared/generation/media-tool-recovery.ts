// IKJJQW（IKIXK9-SPEC-20261002 B.3）：单结果媒体工具接入恢复协议 v1 的共享受理段。
// 覆盖本票 11 个创建入口（擦除/去字幕/音视频分离/截取/调速/抠像/抠图/扩图/图像高清/
// 视频 HD/插帧）：canvas_binding 剥离与纯载荷校验、请求摘要、幂等快路径、事务内
// 「恢复锁序核对 → 建 job 行 → 关联行 → 幂等行」一体提交、canvas_binding 视图回填。
// 持久机制全部复用 IKJJQU 交付（generation-canvas-recovery-repo / generation-job-idempotency），
// 不建第二套恢复存储；无 canvas_binding 的历史请求保持各工具原有路径与语义（B.3/B.7）。
import { createHash } from "node:crypto";

import {
  canvasBindingSchema,
  IDEMPOTENCY_CONFLICT_CODE,
  type CanvasBinding,
  type RecoveryErrorEnvelope,
  type ResultEnvelope,
  fail,
  ok,
} from "@lib/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  RecoveryContractError,
  canvasBindingView,
  lockCanvasRecoveryForAcceptance,
  readCreateIdempotency,
  writeCanvasRecoveryRows,
  transactionWithUniqueRetry,
  type CanvasRecoveryAcceptance,
} from "@lib/shared/persistence/index.js";
// 深路径 import（先例：video-mattings.service.ts 的 conversation-repo.js）——writeCreateIdempotency
// 与 CanvasBindingView 类型未从 persistence/index.ts 导出，本票不改 IKJJQU 交付的导出面。
import { writeCreateIdempotency } from "@lib/shared/persistence/generation-job-idempotency.js";
import type { CanvasBindingView } from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import { canonicalJson } from "./handle-create-generation-job.js";

/** 从建任务 body 剥离 canvas_binding（基础设施键，不进各工具业务 zod——同 client_token 口径）。
 *  返回 invalid=true 表示携带了 canvas_binding 但载荷非法（B.8 invalid_recovery_payload）。 */
export function takeCanvasBinding(
  body: Record<string, unknown>,
): { binding: CanvasBinding | null; rest: Record<string, unknown>; invalid: boolean } {
  if (body.canvas_binding === undefined) {
    return { binding: null, rest: body, invalid: false };
  }
  const parsed = canvasBindingSchema.safeParse(body.canvas_binding);
  if (!parsed.success) {
    return { binding: null, rest: body, invalid: true };
  }
  const { canvas_binding: _stripped, ...rest } = body;
  return { binding: parsed.data, rest, invalid: false };
}

/** 建任务请求摘要（与 generationCreateRequestHash 同口径 method:operation:path:canonicalJson）。
 *  摘要覆盖原业务参数与完整 canvas_binding（B.3），不含认证 token。 */
export function mediaToolRequestHash(
  operation: string,
  projectId: string,
  requestPath: string,
  body: unknown,
): string {
  return createHash("sha256")
    .update(`POST:${operation}:/projects/${projectId}${requestPath}:${canonicalJson(body)}`)
    .digest("hex");
}

/** 带恢复协议的受理参数（各工具 service 在业务校验后组装）。 */
export interface MediaToolRecovery {
  projectId: string;
  userId: string;
  /** 本次任务类型（generation_jobs.type）。 */
  taskType: string;
  /** 幂等域（各工具既有命名空间，如 video_matting.create / image_erase.create）。 */
  operation: string;
  /** 覆盖业务参数与完整 canvas_binding 的请求摘要。 */
  requestHash: string;
  binding: CanvasBinding;
}

/** 无 canvas_binding 但有既有幂等承载的入口参数（video-mattings 的 client_token 形态）。 */
export interface MediaToolLegacyIdempotency {
  projectId: string;
  operation: string;
  requestHash: string;
  key: string;
}

export type MediaToolCreateOutcome =
  | { kind: "ok"; jobId: string; status: string; bindingView: CanvasBindingView | null }
  | { kind: "idempotency_conflict" }
  | { kind: "envelope"; envelope: RecoveryErrorEnvelope };

/** IKJLTX（R5）：锁外前置幂等回读的产出——受理段之外命中重放时可直接渲染给客户端。 */
export type MediaToolReplayOutcome = Exclude<MediaToolCreateOutcome, { kind: "envelope" }>;

/** 重放/建行后的任务当前状态（B.3：原 API 可继续返回实时任务状态）。 */
async function currentJobStatus(db: PrismaClient | Prisma.TransactionClient, jobId: string): Promise<string> {
  const row = await db.generation_jobs.findUnique({
    where: { id: BigInt(jobId) },
    select: { status: true },
  });
  if (!row) {
    // 与 readCreateIdempotency「幂等行缺 job_id」同口径：数据被外部改过的异常态，宁可报错。
    throw new Error(`恢复重放的任务行不存在：jobId=${jobId}`);
  }
  return row.status;
}

/** IKJLTX（R5）：同身份同载荷的原意图锁外回读（B.3 受理事务顺序第 1 步的独立形态）。
 *  供各工具 service 在素材/模型/报价等**可变状态**校验之前调用：命中则返回原 job（现查状态）
 *  与原关联（binding 形态回填 canvas_binding 视图），同键异载荷判冲突；未受理过返回 null，
 *  调用方继续既有校验与建行流程。摘要只依赖请求载荷与 canvas_binding，与可变状态无关。 */
export async function readAcceptedMediaToolReplay(
  prisma: PrismaClient,
  recovery: MediaToolRecovery,
): Promise<MediaToolReplayOutcome | null>;
export async function readAcceptedMediaToolReplay(
  prisma: PrismaClient,
  legacy: MediaToolLegacyIdempotency,
): Promise<MediaToolReplayOutcome | null>;
export async function readAcceptedMediaToolReplay(
  prisma: PrismaClient,
  lookup: MediaToolRecovery | MediaToolLegacyIdempotency,
): Promise<MediaToolReplayOutcome | null> {
  const binding = "binding" in lookup ? lookup.binding : null;
  const key = binding ? binding.submission_id : (lookup as MediaToolLegacyIdempotency).key;
  const replayed = await readCreateIdempotency(
    prisma,
    lookup.projectId,
    { key, requestHash: lookup.requestHash },
    lookup.operation,
  );
  if (!replayed) return null;
  if ("kind" in replayed) return { kind: "idempotency_conflict" };
  return {
    kind: "ok",
    jobId: replayed.generation_job_id,
    status: await currentJobStatus(prisma, replayed.generation_job_id),
    bindingView: binding
      ? await canvasBindingView(prisma, lookup.projectId, binding.submission_id)
      : null,
  };
}

/** IKJLTX（R5）：前置回读命中的统一响应渲染（与各服务建行成功/冲突的响应口径一致）。
 *  legacyConflict 仅 video-mattings 无 canvas_binding 老路径使用（client_token 既有码与文案）。
 *  返回类型省略注解由 fail/ok 重载推断——保持 data 的窄类型，controller 侧 result.data.job_id
 *  照常窄化。 */
export function renderMediaToolReplay(
  replay: MediaToolReplayOutcome,
  legacyConflict?: () => ResultEnvelope<never>,
) {
  if (replay.kind === "idempotency_conflict") {
    return legacyConflict ? legacyConflict() : fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  }
  return ok({
    job_id: replay.jobId,
    status: replay.status,
    ...(replay.bindingView ? { canvas_binding: replay.bindingView } : {}),
  });
}

/**
 * 单结果媒体工具的建任务受理主体（B.3「受理事务顺序」）：
 *  1. 锁外回读幂等——同身份同载荷重放原 job（现查状态），不重做当前状态校验；
 *  2. 事务内恢复锁序核对（项目 → 画布 → 锁内回读幂等 → 节点归属版本比对），
 *     绑定冲突在 job 写入前抛出（零写入零预扣）；
 *  3. createJob 闭包（各工具既有建行）→ writeCanvasRecoveryRows → writeCreateIdempotency
 *     一体提交；并发同键输家由唯一索引兜底 + transactionWithUniqueRetry 收敛。
 *
 * recovery 为 null 且 legacy 为 null（历史无幂等请求）：直接执行 createJob，不包事务——
 * 与各工具接入前行为逐字节一致。
 * recovery 为 null 且 legacy 非 null（video-mattings 无 canvas_binding 老路径）：
 * 事务内回读幂等 → 建行 → 幂等行（保持其原有同事务原子性，仅业务校验由调用方提前）。
 */
export async function createMediaToolJobWithRecovery(
  prisma: PrismaClient,
  recovery: MediaToolRecovery | null,
  createJob: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<{ jobId: string; status: string }>,
  legacy?: MediaToolLegacyIdempotency,
): Promise<MediaToolCreateOutcome> {
  if (!recovery && !legacy) {
    const created = await createJob(prisma);
    return { kind: "ok", ...created, bindingView: null };
  }
  const operation = recovery ? recovery.operation : legacy!.operation;
  const key = recovery ? recovery.binding.submission_id : legacy!.key;
  const requestHash = recovery ? recovery.requestHash : legacy!.requestHash;
  const projectId = recovery ? recovery.projectId : legacy!.projectId;
  // B.3 第 1 步：锁外幂等回读（快路径；媒体工具无预扣，重放零副作用）。
  // 同身份同载荷重放原 job（现查状态，不重做当前状态校验）；同键异载荷判冲突。
  // IKJLTX：回读逻辑与各 service 的前置回读（readAcceptedMediaToolReplay）单源。
  const replayed = recovery
    ? await readAcceptedMediaToolReplay(prisma, recovery)
    : await readAcceptedMediaToolReplay(prisma, {
        projectId,
        operation,
        requestHash,
        key,
      });
  if (replayed) return replayed;
  // 事务体：锁内回读兜底（并发赢家在锁外 miss 与事务开始之间提交的情形）。
  const runTx = () =>
    transactionWithUniqueRetry(prisma, async (tx) => {
      if (recovery) {
        const acceptance: CanvasRecoveryAcceptance = {
          projectId: recovery.projectId,
          userId: recovery.userId,
          binding: recovery.binding,
          operation,
          requestHash,
          idempotencyKey: key,
          taskType: recovery.taskType,
        };
        const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance);
        if (locked.kind === "idempotency_conflict") return { conflict: true } as const;
        if (locked.kind === "replay") return { replayJobId: locked.result.generation_job_id } as const;
        const created = await createJob(tx);
        await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.jobId));
        await writeCreateIdempotency(
          tx,
          {
            projectId: recovery.projectId,
            jobId: BigInt(created.jobId),
            // 媒体工具无事件游标语义（video-mattings 先例恒 0，表非空约束占位）。
            acceptedCursor: "0",
          },
          { key, requestHash },
          operation,
        );
        return { created } as const;
      }
      // legacy 形态（video-mattings 无 canvas_binding）：事务内回读幂等 + 建行 + 幂等行。
      // （as 转换：readCreateIdempotency 的签名收 PrismaClient，事务客户端结构兼容——只用到
      // command_idempotency.findUnique，不改 IKJJQU 交付的函数签名。）
      const existing = await readCreateIdempotency(
        tx as unknown as PrismaClient,
        projectId,
        { key, requestHash },
        operation,
      );
      if (existing) {
        if ("kind" in existing) return { conflict: true } as const;
        return { replayJobId: existing.generation_job_id } as const;
      }
      const created = await createJob(tx);
      await writeCreateIdempotency(
        tx,
        { projectId, jobId: BigInt(created.jobId), acceptedCursor: "0" },
        { key, requestHash },
        operation,
      );
      return { created } as const;
    });
  let outcome: Awaited<ReturnType<typeof runTx>>;
  try {
    outcome = await runTx();
  } catch (error) {
    // B.8：新协议受控错误（canvas_binding_conflict / invalid_recovery_payload）信封直出。
    if (error instanceof RecoveryContractError) {
      return { kind: "envelope", envelope: error.envelope };
    }
    throw error;
  }
  if ("conflict" in outcome) return { kind: "idempotency_conflict" };
  if ("replayJobId" in outcome) {
    return {
      kind: "ok",
      jobId: outcome.replayJobId,
      status: await currentJobStatus(prisma, outcome.replayJobId),
      bindingView: recovery
        ? await canvasBindingView(prisma, projectId, recovery.binding.submission_id)
        : null,
    };
  }
  return {
    kind: "ok",
    ...outcome.created,
    bindingView: recovery
      ? await canvasBindingView(prisma, projectId, recovery.binding.submission_id)
      : null,
  };
}
