import { Injectable } from "@nestjs/common";
import { createStoryboardPreviewRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

type Repo = ReturnType<typeof createStoryboardPreviewRepo>;

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
