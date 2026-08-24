import { Injectable } from "@nestjs/common";
import { createSkillRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class SkillService {
  private repoInstance?: ReturnType<typeof createSkillRepo>;

  private get repo(): ReturnType<typeof createSkillRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createSkillRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listLibrary(
    userId: string,
    filter: Parameters<ReturnType<typeof createSkillRepo>["listLibrary"]>[1],
  ) {
    return this.repo.listLibrary(userId, filter);
  }

  /** IKA64P：官方技能全文 */
  getOfficialContent(creativeId: string) {
    return this.repo.getOfficialContent(creativeId);
  }

  listMine(
    userId: string,
    filter: Parameters<ReturnType<typeof createSkillRepo>["listMine"]>[1],
  ) {
    return this.repo.listMine(userId, filter);
  }

  resolveOfficialSkillId(creativeSkillId: string) {
    return this.repo.resolveOfficialSkillId(creativeSkillId);
  }

  addReference(userId: string, skillId: string) {
    return this.repo.addReference(userId, skillId);
  }

  removeReferenceByCreativeSkillId(userId: string, creativeSkillId: string) {
    return this.repo.removeReferenceByCreativeSkillId(userId, creativeSkillId);
  }

  findAssetDomainInfo(creativeSkillId: string) {
    return this.repo.findAssetDomainInfo(creativeSkillId);
  }

  updateAutoByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
    auto: boolean,
  ) {
    return this.repo.updateAutoByCreativeSkillId(userId, creativeSkillId, auto);
  }

  updatePersonalAutoByCreativeSkillId(
    userId: string,
    creativeSkillId: string,
    auto: boolean,
  ) {
    return this.repo.updatePersonalAutoByCreativeSkillId(
      userId,
      creativeSkillId,
      auto,
    );
  }

  createPersonalSkill(
    userId: string,
    input: Parameters<ReturnType<typeof createSkillRepo>["createPersonalSkill"]>[1],
  ) {
    return this.repo.createPersonalSkill(userId, input);
  }

  findPersonalContent(userId: string, creativeSkillId: string) {
    return this.repo.findPersonalContent(userId, creativeSkillId);
  }

  deletePersonal(userId: string, creativeSkillId: string) {
    return this.repo.deletePersonal(userId, creativeSkillId);
  }
}
