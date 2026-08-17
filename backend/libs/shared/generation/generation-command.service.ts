import { Injectable } from "@nestjs/common";
import { createGenerationCommandRepo } from "@blue-whale/persistence";
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
}
