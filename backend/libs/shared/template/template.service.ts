import { Injectable } from "@nestjs/common";
import { createTemplateRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** 首页模板读取侧依赖：wire Prisma template repo。 */
@Injectable()
export class TemplateService {
  private repoInstance?: ReturnType<typeof createTemplateRepo>;

  private get repo(): ReturnType<typeof createTemplateRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createTemplateRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listTags() {
    return this.repo.listTags();
  }

  /** IKA64P：管理端全量标签（含隐藏） */
  listAllTags() {
    return this.repo.listAllTags();
  }

  pageByTagCode(tagCode: string, current: number, size: number) {
    return this.repo.pageByTagCode(tagCode, current, size);
  }
}
