import type { BillingCharge } from "@lib/shared/billing/billing-charge.js";
import type { BillingRelease } from "@lib/shared/billing/billing-release.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

export interface JobBilling {
  charge(jobId: number): Promise<void>;
  release(jobId: number, reason: string): Promise<void>;
}

export interface JobBillingSource {
  charge: BillingCharge;
  release: BillingRelease;
}

export type JobExistenceProbe = (jobId: number) => Promise<boolean>;

export function jobExistenceProbe(client: {
  generation_jobs: {
    findUnique(args: {
      where: { id: bigint };
      select: { id: true };
    }): Promise<unknown>;
  };
}): JobExistenceProbe {
  return async (jobId) =>
    (await client.generation_jobs.findUnique({
      where: { id: BigInt(jobId) },
      select: { id: true },
    })) != null;
}

const PROBE_ATTEMPTS = 2;
const PROBE_RETRY_DELAY_MS = 100;

export async function releaseUnlessJobCommitted(args: {
  release: JobBilling["release"] | undefined;
  jobId: number | null;
  probe?: JobExistenceProbe | undefined;
  reason: string;
}): Promise<boolean> {
  if (!args.release || args.jobId === null) return false;
  if (!args.probe) {
    await args.release(args.jobId, args.reason);
    return true;
  }
  let exists: boolean | null = null;
  for (let attempt = 0; attempt < PROBE_ATTEMPTS && exists === null; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
    }
    try {
      exists = await args.probe(args.jobId);
    } catch (error) {
      logger.warn("扣费补偿前核对任务是否已提交失败", {
        jobId: args.jobId,
        attempt: attempt + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (exists === true) return false;
  if (exists === null) {
    logger.error("扣费补偿无法确认任务落库状态，跳过释放等待人工核对", {
      jobId: args.jobId,
    });
    return false;
  }
  await args.release(args.jobId, args.reason);
  return true;
}

export async function withBillingCompensation<T>(
  billing: JobBilling | undefined,
  run: (billing: JobBilling | undefined) => Promise<T>,
  probe?: JobExistenceProbe,
  onReleased?: () => void,
): Promise<T> {
  if (!billing) return run(undefined);
  const held = { jobId: null as number | null };
  try {
    return await run({
      charge: async (jobId) => {
        await billing.charge(jobId);
        held.jobId = jobId;
      },
      release: billing.release,
    });
  } catch (error) {
    const released = await releaseUnlessJobCommitted({
      release: billing.release,
      jobId: held.jobId,
      probe,
      reason: error instanceof Error ? error.message : String(error),
    });
    if (released) onReleased?.();
    throw error;
  }
}
