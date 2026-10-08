import { Injectable } from "@nestjs/common";
import { createSkillRepo } from "@lib/shared/persistence/index.js";
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

  getOfficialContent(creativeId: string) {
    return this.repo.getOfficialContent(creativeId);
  }

  findAgentSkill(creativeSkillId: string, requestingUserId: string) {
    return this.repo.findAgentSkill(creativeSkillId, requestingUserId);
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
