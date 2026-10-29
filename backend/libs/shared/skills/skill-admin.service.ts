import { Injectable } from "@nestjs/common";
import { createSkillAdminRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createSkillAdminRepo>;

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

  getOfficialSkill(id: bigint) {
    return this.repo.getOfficialSkill(id);
  }

  updateOfficialSkill(
    id: bigint,
    input: {
      name?: string;
      description?: string | null;
      body?: string | null;
      category?: string;
    },
  ) {
    return this.repo.updateOfficialSkill(id, input);
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
