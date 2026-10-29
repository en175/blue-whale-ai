import { Injectable } from "@nestjs/common";
import { createProjectRepo } from "@lib/shared/persistence/index.js";
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

  findOwnerId(id: string) {
    return this.repo.findOwnerId(id);
  }

  listByOwner(
    ownerId: string,
    options?: Parameters<ReturnType<typeof createProjectRepo>["listByOwner"]>[1],
  ) {
    return this.repo.listByOwner(ownerId, options);
  }

  listByOwnerPaged(
    ownerId: string,
    page: number,
    size: number,
    options?: Parameters<ReturnType<typeof createProjectRepo>["listByOwnerPaged"]>[3],
  ) {
    return this.repo.listByOwnerPaged(ownerId, page, size, options);
  }

  listByOwnerRecent(
    ownerId: string,
    limit: number,
    options?: Parameters<ReturnType<typeof createProjectRepo>["listByOwnerRecent"]>[2],
  ) {
    return this.repo.listByOwnerRecent(ownerId, limit, options);
  }

  create(ownerId: string, name: string) {
    return this.repo.create(ownerId, name);
  }

  rename(id: string, ownerId: string, name: string) {
    return this.repo.rename(id, ownerId, name);
  }

  touchLastOpened(id: string, ownerId: string) {
    return this.repo.touchLastOpened(id, ownerId);
  }

  setPinned(id: string, ownerId: string, pinned: boolean) {
    return this.repo.setPinned(id, ownerId, pinned);
  }

  delete(id: string, ownerId: string) {
    return this.repo.delete(id, ownerId);
  }

  batchDelete(ownerId: string, ids: string[]) {
    return this.repo.batchDelete(ownerId, ids);
  }
}
