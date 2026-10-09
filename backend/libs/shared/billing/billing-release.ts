import {
  getStartedRocketMqProducer,
  loadRocketMqConfig,
} from "@lib/infra/mq/rocketmq-producer.js";

export const BILLING_JOB_FAILED_TOPIC = "generation-job-failed";

export interface BillingReleaseContext {
  userId: string;
  jobId: number;
  reason: string;
}

export type BillingRelease = (ctx: BillingReleaseContext) => Promise<void>;

export interface BillingJobFailedEvent {
  jobId: number;
  userId: number;
  reason: string;
}

export interface BillingReleaseDeps {
  publish: (event: BillingJobFailedEvent) => Promise<void>;
  logger?: { error: (message: string) => void };
}

export function createBillingRelease(deps: BillingReleaseDeps): BillingRelease {
  return async (ctx) => {
    try {
      await deps.publish({
        jobId: ctx.jobId,
        userId: Number(ctx.userId),
        reason: ctx.reason,
      });
    } catch (error) {
      deps.logger?.error(
        `[billing] 预扣补偿返还失败，这笔钱仍冻着：jobId=${ctx.jobId} 原因=${ctx.reason} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

export async function publishBillingJobFailed(
  event: BillingJobFailedEvent,
): Promise<void> {
  const producer = await getStartedRocketMqProducer(loadRocketMqConfig());
  await producer.send({
    topic: BILLING_JOB_FAILED_TOPIC,
    body: Buffer.from(JSON.stringify(event)),
  });
}
