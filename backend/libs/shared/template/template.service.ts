import { Injectable } from "@nestjs/common";
import { createTemplateRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

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

  listAllTags() {
    return this.repo.listAllTags();
  }

  pageCards(query: Parameters<ReturnType<typeof createTemplateRepo>["pageCards"]>[0]) {
    return this.repo.pageCards(query);
  }
}
