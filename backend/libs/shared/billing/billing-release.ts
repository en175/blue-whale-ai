import {
  getStartedRocketMqProducer,
  loadRocketMqConfig,
} from "@lib/infra/mq/rocketmq-producer.js";

export const BILLING_JOB_TERMINAL_TOPIC = "generation-job-terminal";

export interface BillingReleaseContext {
  userId: string;
  jobId: number;
  reason: string;
}

export type BillingRelease = (ctx: BillingReleaseContext) => Promise<void>;

export interface BillingJobTerminalEvent {
  jobId: number;
  userId: number;
  status: string;
  reason: string;
  refund: boolean;
}

export interface BillingReleaseDeps {
  publish: (event: BillingJobTerminalEvent) => Promise<void>;
  logger?: { error: (message: string) => void };
}

export function createBillingRelease(deps: BillingReleaseDeps): BillingRelease {
  return async (ctx) => {
    try {
      await deps.publish({
        jobId: ctx.jobId,
        userId: Number(ctx.userId),
        status: "failed",
        reason: ctx.reason,
        refund: true,
      });
    } catch (error) {
      deps.logger?.error(
        `[billing] 终态事件发布失败，这笔钱仍扣着：jobId=${ctx.jobId} status=failed 原因=${ctx.reason} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

export async function publishBillingJobTerminal(
  event: BillingJobTerminalEvent,
): Promise<void> {
  const producer = await getStartedRocketMqProducer(loadRocketMqConfig());
  await producer.send({
    topic: BILLING_JOB_TERMINAL_TOPIC,
    body: Buffer.from(JSON.stringify(event)),
  });
}
