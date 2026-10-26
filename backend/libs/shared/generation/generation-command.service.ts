import { Injectable } from "@nestjs/common";
import {
  createGenerationCommandRepo,
  createAssetOwnershipOps,
  createFinalizeCommandRepo,
  type JobBillingSource,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createGenerationCommandRepo>;
type FinalizeRepo = ReturnType<typeof createFinalizeCommandRepo>;

@Injectable()
export class GenerationCommandService {
  private repoInstance?: Repo;
  private finalizeInstance?: FinalizeRepo;

  get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createGenerationCommandRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  get finalize(): FinalizeRepo {
    if (!this.finalizeInstance) {
      this.finalizeInstance = createFinalizeCommandRepo(this.prisma.client);
    }
    return this.finalizeInstance;
  }

  get assets() {
    return createAssetOwnershipOps(this.prisma.client);
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
    guardInput?: (
      input: Record<string, unknown>,
      jobType: string,
    ) => Promise<string | null>,
    billing?: JobBillingSource,
  ) {
    return this.repo.retryJob(
      jobId,
      projectId,
      userId,
      idempotencyKey,
      requestHash,
      guardInput,
      undefined,
      billing,
    );
  }

  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<boolean> {
    return this.repo.markFailedQueued(jobId, code, message, details);
  }
}
