import { Injectable } from "@nestjs/common";
import {
  createGenerationCommandRepo,
  createAssetOwnershipOps,
} from "@lib/shared/persistence/index.js";
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

  /** IKE7JP：提交时复用 worker 资产归属查询（resolveInputAssets），校验参考素材存在性/类型。
   *  与 worker 同一份归属逻辑（项目直属 ∪ 全局 ∪ project_asset 关联），不会前后漂移。 */
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
  ) {
    return this.repo.retryJob(
      jobId,
      projectId,
      userId,
      idempotencyKey,
      requestHash,
      guardInput,
    );
  }

  /** 入队失败兜底（IKCR78，对齐 media-extract markFailed）：queued 任务直接置 failed，
   *  避免音频任务入队失败后无消费端处理而静默悬挂。只改 queued 态，不改终态/在途。
   *  IKBQEE / ADR-0078：details 落调试原文，禁展示用户。逻辑在 repo.markFailedQueued（IKDZGH 收敛）。 */
  async markFailed(
    jobId: string,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    return this.repo.markFailedQueued(jobId, code, message, details);
  }
}
