import { Injectable } from "@nestjs/common";
import { createLogger } from "@lib/core/logging";
import { createOperationLogRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class OperationLogService {
  private readonly logger = createLogger("operation-log");
  private repoInstance?: ReturnType<typeof createOperationLogRepo>;

  private get repo(): ReturnType<typeof createOperationLogRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createOperationLogRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  list(filter: {
    category?: string;
    searchText?: string;
    from?: Date;
    to?: Date;
  }) {
    return this.repo.list(filter);
  }

  create(
    input: Parameters<ReturnType<typeof createOperationLogRepo>["create"]>[0],
  ) {
    return this.repo.create(input);
  }

  async record(
    input: Parameters<ReturnType<typeof createOperationLogRepo>["create"]>[0],
  ): Promise<void> {
    try {
      await this.repo.create(input);
    } catch (error) {
      this.logger.error(
        `操作记录写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async finish(
    ref: string,
    input: Parameters<ReturnType<typeof createOperationLogRepo>["finishByRef"]>[1],
  ): Promise<void> {
    try {
      await this.repo.finishByRef(ref, input);
    } catch (error) {
      this.logger.error(
        `操作记录收尾失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  findByRef(ref: string) {
    return this.repo.findByRef(ref);
  }
}
