import { Injectable } from "@nestjs/common";
import { createProjectRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class ProjectService {
  private repoInstance?: ReturnType<typeof createProjectRepo>;

  private get repo(): ReturnType<typeof createProjectRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createProjectRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  findOwnedById(id: string, ownerId: string) {
    return this.repo.findOwnedById(id, ownerId);
  }

  /** 按项目号解出主人（计费归属用，见 ProjectRepo.findOwnerId）。 */
  findOwnerId(id: string) {
    return this.repo.findOwnerId(id);
  }

  listByOwner(ownerId: string) {
    return this.repo.listByOwner(ownerId);
  }

  create(ownerId: string, name: string) {
    return this.repo.create(ownerId, name);
  }

  rename(id: string, ownerId: string, name: string) {
    return this.repo.rename(id, ownerId, name);
  }

  delete(id: string, ownerId: string) {
    return this.repo.delete(id, ownerId);
  }

  batchDelete(ownerId: string, ids: string[]) {
    return this.repo.batchDelete(ownerId, ids);
  }
}
