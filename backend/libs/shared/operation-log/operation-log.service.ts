import { Injectable } from "@nestjs/common";
import { createOperationLogRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** OperationLog 用例依赖：wire Prisma admin_operation_logs repo。 */
@Injectable()
export class OperationLogService {
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
}
