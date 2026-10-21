export interface BillingReleaseContext {
  userId: string;
  jobId: number;
  reason: string;
}

export type BillingRelease = (ctx: BillingReleaseContext) => Promise<void>;

export interface BillingReleaseDeps {
  enqueue: (ctx: BillingReleaseContext) => Promise<void>;
  logger?: { error: (message: string) => void };
}

export function createBillingRelease(deps: BillingReleaseDeps): BillingRelease {
  return async (ctx) => {
    try {
      await deps.enqueue(ctx);
    } catch (error) {
      deps.logger?.error(
        `[billing] 终态事件入队失败：jobId=${ctx.jobId} 原因=${ctx.reason} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };
}

export interface TerminalOutboxClient {
  generation_outbox: {
    create(args: {
      data: {
        job_id: bigint;
        user_id: bigint;
        terminal_status: string;
        reason: string;
      };
    }): Promise<unknown>;
  };
}

export function createOutboxTerminalEnqueue(
  prisma: TerminalOutboxClient,
): (ctx: BillingReleaseContext) => Promise<void> {
  return async (ctx) => {
    await prisma.generation_outbox.create({
      data: {
        job_id: BigInt(ctx.jobId),
        user_id: BigInt(ctx.userId),
        terminal_status: "failed",
        reason: ctx.reason.slice(0, 512),
      },
    });
  };
}
