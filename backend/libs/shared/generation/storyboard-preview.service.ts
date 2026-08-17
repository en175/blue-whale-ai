import { Injectable } from "@nestjs/common";
import { createStoryboardPreviewRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createStoryboardPreviewRepo>;

/** StoryboardPreview repo 封装（SceneCard 显式分镜预览旁路）。 */
@Injectable()
export class StoryboardPreviewService {
  private repoInstance?: Repo;

  get repo(): Repo {
    if (!this.repoInstance) {
      this.repoInstance = createStoryboardPreviewRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}
}
