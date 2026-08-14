import { Injectable } from "@nestjs/common";
import { createSnapshotRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class SnapshotService {
  private repoInstance?: ReturnType<typeof createSnapshotRepo>;

  private get repo(): ReturnType<typeof createSnapshotRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createSnapshotRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  loadJobsAndAssets(projectId: string, userId: string) {
    return this.repo.loadJobsAndAssets(projectId, userId);
  }

  loadConversationState(projectId: string, userId: string) {
    return this.repo.loadConversationState(projectId, userId);
  }
}
