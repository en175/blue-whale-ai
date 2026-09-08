import { Injectable } from "@nestjs/common";
import { createTemplateAdminRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createTemplateAdminRepo>;

/** 模板管理端用例依赖：wire Prisma template admin repo（IK764F）。 */
@Injectable()
export class TemplateAdminService {
  private repoInstance?: Repo;

  private get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createTemplateAdminRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  renameTag(tagCode: string, label: string) {
    return this.repo.renameTag(tagCode, label);
  }

  /** IKA64P：标签隐藏开关 */
  setTagVisibility(tagCode: string, visible: number) {
    return this.repo.setTagVisibility(tagCode, visible);
  }

  listCards(tagCode?: string) {
    return this.repo.listCards(tagCode);
  }

  getCard(id: bigint) {
    return this.repo.getCard(id);
  }

  createCard(input: Parameters<Repo["createCard"]>[0]) {
    return this.repo.createCard(input);
  }

  updateCard(id: bigint, input: Parameters<Repo["updateCard"]>[1]) {
    return this.repo.updateCard(id, input);
  }

  softDeleteCard(id: bigint) {
    return this.repo.softDeleteCard(id);
  }

  moveCard(id: bigint, direction: Parameters<Repo["moveCard"]>[1]) {
    return this.repo.moveCard(id, direction);
  }

  moveImage(imageId: bigint, direction: Parameters<Repo["moveImage"]>[1]) {
    return this.repo.moveImage(imageId, direction);
  }
}
