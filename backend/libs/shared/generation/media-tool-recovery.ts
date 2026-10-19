import { createHash } from "node:crypto";

import {
  canvasBindingSchema,
  IDEMPOTENCY_CONFLICT_CODE,
  RECOVERY_REASONS,
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
import { writeCreateIdempotency } from "@lib/shared/persistence/generation-job-idempotency.js";
import {
  withBillingCompensation,
  type JobBilling,
} from "@lib/shared/persistence/job-billing.js";
import type { CanvasBindingView } from "@lib/shared/persistence/generation-canvas-recovery-repo.js";
import { canonicalJson } from "./handle-create-generation-job.js";

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

export function stripCanvasBinding(
  body: Record<string, unknown>,
  carrierLabel: string,
  carrierValue: string,
):
  | { error: ResultEnvelope<never> }
  | { error: null; binding: CanvasBinding | null; rest: Record<string, unknown> } {
  const { binding, rest, invalid } = takeCanvasBinding(body);
  if (invalid) {
    return {
      error: fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload }),
    };
  }
  if (binding && carrierValue !== binding.submission_id) {
    return {
      error: fail(400, `${carrierLabel} 必须等于 canvas_binding.submission_id`, {
        reason: RECOVERY_REASONS.invalidPayload,
      }),
    };
  }
  return { error: null, binding, rest };
}

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

export interface MediaToolRecovery {
  projectId: string;
  userId: string;
  taskType: string;
  operation: string;
  requestHash: string;
  binding: CanvasBinding;
}

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

export type MediaToolReplayOutcome = Exclude<MediaToolCreateOutcome, { kind: "envelope" }>;

async function currentJobStatus(db: PrismaClient | Prisma.TransactionClient, jobId: string): Promise<string> {
  const row = await db.generation_jobs.findUnique({
    where: { id: BigInt(jobId) },
    select: { status: true },
  });
  if (!row) {
    throw new Error(`恢复重放的任务行不存在：jobId=${jobId}`);
  }
  return row.status;
}

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
  const key = "binding" in lookup ? lookup.binding.submission_id : lookup.key;
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

export async function replayAcceptedMediaTool(
  prisma: PrismaClient,
  identity: {
    projectId: string;
    userId: string;
    binding: CanvasBinding | null;
    taskType: string;
    operation: string;
    requestPath: string;
    body: Record<string, unknown>;
  },
): Promise<{
  recovery: MediaToolRecovery | null;
  replayed: ReturnType<typeof renderMediaToolReplay> | null;
}> {
  const recovery: MediaToolRecovery | null = identity.binding
    ? {
        projectId: identity.projectId,
        userId: identity.userId,
        taskType: identity.taskType,
        operation: identity.operation,
        requestHash: mediaToolRequestHash(
          identity.operation,
          identity.projectId,
          identity.requestPath,
          identity.body,
        ),
        binding: identity.binding,
      }
    : null;
  const replay = recovery
    ? await readAcceptedMediaToolReplay(prisma, recovery)
    : null;
  return { recovery, replayed: replay ? renderMediaToolReplay(replay) : null };
}

export async function createMediaToolJobWithRecovery(
  prisma: PrismaClient,
  recovery: MediaToolRecovery | null,
  createJob: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<{ jobId: string; status: string }>,
  legacy?: MediaToolLegacyIdempotency,
  billing?: JobBilling,
): Promise<MediaToolCreateOutcome> {
  if (!recovery && !legacy) {
    const created = await withBillingCompensation(billing, (jobBilling) =>
      jobBilling === undefined
        ? createJob(prisma)
        : prisma.$transaction(async (tx) => {
            const created = await createJob(tx);
            await jobBilling.charge(Number(created.jobId));
            return created;
          }),
    );
    return { kind: "ok", ...created, bindingView: null };
  }
  const operation = recovery ? recovery.operation : legacy!.operation;
  const key = recovery ? recovery.binding.submission_id : legacy!.key;
  const requestHash = recovery ? recovery.requestHash : legacy!.requestHash;
  const projectId = recovery ? recovery.projectId : legacy!.projectId;
  const replayed = recovery
    ? await readAcceptedMediaToolReplay(prisma, recovery)
    : await readAcceptedMediaToolReplay(prisma, {
        projectId,
        operation,
        requestHash,
        key,
      });
  if (replayed) return replayed;
  const runTx = (jobBilling: JobBilling | undefined) =>
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
        await jobBilling?.charge(Number(created.jobId));
        await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.jobId));
        await writeCreateIdempotency(
          tx,
          {
            projectId: recovery.projectId,
            jobId: BigInt(created.jobId),
            acceptedCursor: "0",
          },
          { key, requestHash },
          operation,
        );
        return { created } as const;
      }
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
      await jobBilling?.charge(Number(created.jobId));
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
    outcome = await withBillingCompensation(billing, (jobBilling) =>
      runTx(jobBilling),
    );
  } catch (error) {
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
