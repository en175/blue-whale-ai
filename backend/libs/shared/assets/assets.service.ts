import { Injectable } from "@nestjs/common";
import { createAssetRepo } from "@blue-whale/persistence";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";

@Injectable()
export class AssetService {
  private repoInstance?: ReturnType<typeof createAssetRepo>;

  private get repo(): ReturnType<typeof createAssetRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createAssetRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(private readonly prisma: PrismaService) {}

  listByUser(
    userId: string,
    filter: Parameters<ReturnType<typeof createAssetRepo>["listByUser"]>[1],
  ) {
    return this.repo.listByUser(userId, filter);
  }

  softDeleteOwned(assetId: string, userId: string) {
    return this.repo.softDeleteOwned(assetId, userId);
  }

  findOwnedSource(sourceAssetId: string, userId: string) {
    return this.repo.findOwnedSource(sourceAssetId, userId);
  }

  findCommittedUpload(userId: string, storageKey: string) {
    return this.repo.findCommittedUpload(userId, storageKey);
  }

  createUploadedAsset(
    input: Parameters<ReturnType<typeof createAssetRepo>["createUploadedAsset"]>[0],
  ) {
    return this.repo.createUploadedAsset(input);
  }

  findAccessible(projectId: string, assetId: string, userId: string) {
    return this.repo.findAccessible(projectId, assetId, userId);
  }

  insertCopy(
    projectId: string,
    userId: string,
    source: Parameters<ReturnType<typeof createAssetRepo>["insertCopy"]>[2],
  ) {
    return this.repo.insertCopy(projectId, userId, source);
  }
}
