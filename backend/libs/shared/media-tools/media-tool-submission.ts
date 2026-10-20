import type { Prisma, PrismaClient } from "@prisma/client";
import {
  ERROR_ENQUEUE_FAILED,
  IDEMPOTENCY_CONFLICT_CODE,
  fail,
  ok,
  type RecoveryErrorEnvelope,
  type ResultEnvelope,
} from "@lib/contracts";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import {
  createMediaToolJobWithRecovery,
  type MediaToolLegacyIdempotency,
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import type { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";

export interface MediaToolSubmissionStrategy {
  prisma: PrismaClient;
  billing: MediaToolBillingService;
  toolType: string;
  userId: string;
  input: Record<string, unknown>;
  recovery: MediaToolRecovery | null;
  legacy?: MediaToolLegacyIdempotency;
  createJob: (
    db: PrismaClient | Prisma.TransactionClient,
  ) => Promise<{ jobId: string; status: string }>;
  enqueue: (jobId: string) => Promise<void>;
}

export type MediaToolJobEnvelope =
  | ResultEnvelope<{
      job_id: string;
      status: string;
      canvas_binding?: Record<string, unknown>;
    }>
  | RecoveryErrorEnvelope;

async function releaseEnqueueFailure(
  args: {
    prisma: PrismaClient;
    billing: MediaToolBillingService;
    userId: string;
    toolType: string;
  },
  jobId: string,
  billed: boolean,
): Promise<void> {
  const transitioned = await createGenerationCommandRepo(args.prisma)
    .markFailedQueued(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
      raw: "RocketMQ 入队失败",
    })
    .catch(() => false);
  if (!transitioned || !billed) return;
  await args.billing.release(args.userId, Number(jobId), "任务入队失败");
}

export async function enqueueMediaToolJob(args: {
  prisma: PrismaClient;
  billing: MediaToolBillingService;
  userId: string;
  toolType: string;
  jobId: string;
  enqueue: (jobId: string) => Promise<void>;
  releaseOnFailure: boolean;
}): Promise<void> {
  try {
    await args.enqueue(args.jobId);
  } catch (error) {
    logger.error(
      `[media-tool] enqueue failed tool=${args.toolType} jobId=${args.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await releaseEnqueueFailure(
      args,
      args.jobId,
      args.releaseOnFailure,
    ).catch((releaseError) => {
      logger.error(
        `[media-tool] release failed tool=${args.toolType} jobId=${args.jobId}: ${
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        }`,
      );
    });
  }
}

export async function submitMediaToolJob(
  strategy: MediaToolSubmissionStrategy,
): Promise<MediaToolJobEnvelope> {
  const jobBilling = await strategy.billing.jobBilling(
    strategy.toolType,
    strategy.userId,
    strategy.input,
  );
  const outcome = await createMediaToolJobWithRecovery(
    strategy.prisma,
    strategy.recovery,
    strategy.createJob,
    strategy.legacy,
    jobBilling,
  );
  if (outcome.kind === "envelope") return outcome.envelope;
  if (outcome.kind === "idempotency_conflict") {
    return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  }
  await enqueueMediaToolJob({
    prisma: strategy.prisma,
    billing: strategy.billing,
    userId: strategy.userId,
    toolType: strategy.toolType,
    jobId: outcome.jobId,
    enqueue: strategy.enqueue,
    releaseOnFailure: jobBilling !== undefined,
  });
  return ok({
    job_id: outcome.jobId,
    status: outcome.status,
    ...(outcome.bindingView
      ? { canvas_binding: outcome.bindingView as unknown as Record<string, unknown> }
      : {}),
  });
}
