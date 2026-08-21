import { Injectable } from "@nestjs/common";
import { createSceneCardResourceRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class SceneCardResourceService {
  private repoInstance?: ReturnType<typeof createSceneCardResourceRepo>;

  private get repo(): ReturnType<typeof createSceneCardResourceRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createSceneCardResourceRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  getSceneCardResource(userId: string, sceneCardId: string) {
    return this.repo.getSceneCardResource(userId, sceneCardId);
  }

  findOwnedSceneCardWithPreset(userId: string, sceneCardId: string) {
    return this.repo.findOwnedSceneCardWithPreset(userId, sceneCardId);
  }

  copySceneCardToProject(
    input: Parameters<
      ReturnType<typeof createSceneCardResourceRepo>["copySceneCardToProject"]
    >[0],
  ) {
    return this.repo.copySceneCardToProject(input);
  }

  deleteSceneCardResource(
    input: Parameters<
      ReturnType<typeof createSceneCardResourceRepo>["deleteSceneCardResource"]
    >[0],
  ) {
    return this.repo.deleteSceneCardResource(input);
  }
}
