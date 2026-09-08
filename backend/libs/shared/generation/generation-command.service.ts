import { Injectable } from "@nestjs/common";
import { createGenerationCommandRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createGenerationCommandRepo>;

/** Generation 命令 repo 封装（create/cancel/retry）。 */
@Injectable()
export class GenerationCommandService {
  private repoInstance?: Repo;

  get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createGenerationCommandRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  createJob(input: Parameters<Repo["createJob"]>[0]) {
    return this.repo.createJob(input);
  }

  requestCancel(jobId: string, userId: string) {
    return this.repo.requestCancel(jobId, userId);
  }

  retryJob(
    jobId: string,
    projectId: string,
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ) {
    return this.repo.retryJob(
      jobId,
      projectId,
      userId,
      idempotencyKey,
      requestHash,
    );
  }

  /** 入队失败兜底（IKCR78，对齐 media-extract markFailed）：queued 任务直接置 failed，
   *  避免音频任务入队失败后无消费端处理而静默悬挂。只改 queued 态，不改终态/在途。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户。 */
  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.client.generation_jobs.updateMany({
      where: { id: BigInt(jobId), status: "queued" },
      data: {
        status: "failed",
        error: {
          code,
          message,
          ...(details !== undefined ? { details } : {}),
        } as never,
        next_action_at: null,
        version: { increment: 1 },
      },
    });
  }
}
