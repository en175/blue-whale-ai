import { Injectable } from "@nestjs/common";
import { createModelCapabilityRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createModelCapabilityRepo>;

@Injectable()
export class ModelCapabilityReadService {
  private repoInstance?: Repo;

  private get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createModelCapabilityRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listEnabledByType(type: Parameters<Repo["listEnabledByType"]>[0]) {
    return this.repo.listEnabledByType(type);
  }
}
