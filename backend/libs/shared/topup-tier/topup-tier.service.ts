import { Injectable } from "@nestjs/common";
import {
  createTopupTierRepo,
  type TopupTierRepo,
} from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

/** TopupTier 用例依赖：wire Prisma topup_tiers repo。 */
@Injectable()
export class TopupTierService {
  private repoInstance?: TopupTierRepo;

  private get repo(): TopupTierRepo {
    if (!this.repoInstance) {
      this.repoInstance = createTopupTierRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listActive() {
    return this.repo.listActive();
  }

  listAll() {
    return this.repo.listAll();
  }

  getById(id: string) {
    return this.repo.getById(id);
  }

  updateSortOrder(items: { id: string; sortOrder: number }[]) {
    return this.repo.updateSortOrder(items);
  }

  create(input: Parameters<ReturnType<typeof createTopupTierRepo>["create"]>[0]) {
    return this.repo.create(input);
  }

  update(
    id: string,
    input: Parameters<ReturnType<typeof createTopupTierRepo>["update"]>[1],
  ) {
    return this.repo.update(id, input);
  }

  remove(id: string) {
    return this.repo.remove(id);
  }
}
