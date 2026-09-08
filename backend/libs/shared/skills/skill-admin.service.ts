import { Injectable } from "@nestjs/common";
import { createSkillAdminRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createSkillAdminRepo>;

/** 技能管理端用例依赖（IKA64P 后续校准）：wire Prisma skill admin repo。 */
@Injectable()
export class SkillAdminService {
  private repoInstance?: Repo;

  private get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createSkillAdminRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listOfficialSkills() {
    return this.repo.listOfficialSkills();
  }

  listCategories() {
    return this.repo.listCategories();
  }

  setCategory(id: bigint, category: string) {
    return this.repo.setCategory(id, category);
  }

  assignCategory(ids: bigint[], category: string) {
    return this.repo.assignCategory(ids, category);
  }

  backfillOfficialAssets() {
    return this.repo.backfillOfficialAssets();
  }

  renameCategory(from: string, to: string) {
    return this.repo.renameCategory(from, to);
  }

  clearCategory(name: string) {
    return this.repo.clearCategory(name);
  }
}
