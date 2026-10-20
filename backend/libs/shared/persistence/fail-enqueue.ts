import type { PrismaClient } from "@prisma/client";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";

export async function markFailedQueuedAndNotifyBilling(args: {
  prisma: PrismaClient;
  jobId: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  release: (jobId: number) => Promise<void>;
}): Promise<boolean> {
  const transitioned = await createGenerationCommandRepo(args.prisma)
    .markFailedQueued(args.jobId, args.code, args.message, args.details)
    .catch(() => false);
  if (!transitioned) return false;
  try {
    await args.release(Number(args.jobId));
  } catch (error) {
    logger.error(
      `[billing] 失败退款事件发布失败 jobId=${args.jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return true;
}
