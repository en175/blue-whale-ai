import { Injectable } from "@nestjs/common";
import { createSceneCardGenerationRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createSceneCardGenerationRepo>;

/** SceneCard 再生成 repo 封装。 */
@Injectable()
export class SceneCardGenerationService {
  private repoInstance?: Repo;

  get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createSceneCardGenerationRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  regenerateSceneCard(input: Parameters<Repo["regenerateSceneCard"]>[0]) {
    return this.repo.regenerateSceneCard(input);
  }
}
