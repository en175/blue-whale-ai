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
  type MediaToolRecovery,
} from "@lib/shared/generation/media-tool-recovery.js";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import type { MediaToolBillingService } from "@lib/shared/media-tool-pricing/media-tool-billing.service.js";

export interface MediaToolSubmissionStrategy {
  prisma: PrismaClient;
  billing: MediaToolBillingService;
  toolType: string;
  userId: string;
  projectId: string;
  input: Record<string, unknown>;
  recovery: MediaToolRecovery | null;
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
  strategy: MediaToolSubmissionStrategy,
  jobId: string,
): Promise<void> {
  const transitioned = await createGenerationCommandRepo(strategy.prisma)
    .markFailedQueued(jobId, ERROR_ENQUEUE_FAILED, "任务入队失败", {
      raw: "RocketMQ 入队失败",
    })
    .catch(() => false);
  if (!transitioned) return;
  await strategy.billing.release(strategy.userId, Number(jobId), "任务入队失败");
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
    undefined,
    jobBilling,
  );
  if (outcome.kind === "envelope") return outcome.envelope;
  if (outcome.kind === "idempotency_conflict") {
    return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
  }
  try {
    await strategy.enqueue(outcome.jobId);
  } catch (error) {
    logger.error(
      `[media-tool] enqueue failed tool=${strategy.toolType} jobId=${outcome.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await releaseEnqueueFailure(strategy, outcome.jobId).catch((releaseError) => {
      logger.error(
        `[media-tool] release failed tool=${strategy.toolType} jobId=${outcome.jobId}: ${
          releaseError instanceof Error ? releaseError.message : String(releaseError)
        }`,
      );
    });
  }
  return ok({
    job_id: outcome.jobId,
    status: outcome.status,
    ...(outcome.bindingView
      ? { canvas_binding: outcome.bindingView as unknown as Record<string, unknown> }
      : {}),
  });
}
