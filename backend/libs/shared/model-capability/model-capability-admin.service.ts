import { Injectable } from "@nestjs/common";
import { createModelCapabilityAdminRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** ModelCapability 管理端用例依赖：wire Prisma admin repo（IK6T46）。 */
@Injectable()
export class ModelCapabilityAdminService {
  private repoInstance?: ReturnType<typeof createModelCapabilityAdminRepo>;

  private get repo(): ReturnType<typeof createModelCapabilityAdminRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createModelCapabilityAdminRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listAll() {
    return this.repo.listAll();
  }

  getById(id: string) {
    return this.repo.getById(id);
  }

  toggleEnabled(id: string) {
    return this.repo.toggleEnabled(id);
  }

  remove(id: string) {
    return this.repo.remove(id);
  }

  updateSortOrder(
    items: Parameters<
      ReturnType<typeof createModelCapabilityAdminRepo>["updateSortOrder"]
    >[0],
  ) {
    return this.repo.updateSortOrder(items);
  }

  create(
    input: Parameters<
      ReturnType<typeof createModelCapabilityAdminRepo>["create"]
    >[0],
  ) {
    return this.repo.create(input);
  }

  update(
    id: string,
    input: Parameters<
      ReturnType<typeof createModelCapabilityAdminRepo>["update"]
    >[1],
  ) {
    return this.repo.update(id, input);
  }
}
