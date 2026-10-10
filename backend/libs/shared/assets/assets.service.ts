import { Injectable } from "@nestjs/common";
import { createAssetRepo } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { AssetStorageService } from "./storage.service.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

@Injectable()
export class AssetService {
  private repoInstance?: ReturnType<typeof createAssetRepo>;

  private get repo(): ReturnType<typeof createAssetRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createAssetRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AssetStorageService,
  ) {}

  listByUser(
    userId: string,
    filter: Parameters<ReturnType<typeof createAssetRepo>["listByUser"]>[1],
  ) {
    return this.repo.listByUser(userId, filter);
  }

  softDeleteOwned(assetId: string, userId: string) {
    return this.repo.softDeleteOwned(assetId, userId);
  }

  linkAssetToProject(input: { userId: string; assetId: string; projectId: string }) {
    return this.repo.linkAssetToProject(input);
  }

  countReferencingProjects(assetId: string, userId: string) {
    return this.repo.countReferencingProjects(assetId, userId);
  }

  findOwnedByMd5(userId: string, md5: string) {
    return this.repo.findOwnedByMd5(userId, md5);
  }

  findOwnedByMaterialId(userId: string, materialId: string) {
    return this.repo.findOwnedByMaterialId(userId, materialId);
  }

  bindMaterialId(input: {
    userId: string;
    assetId: string;
    materialId: string;
  }) {
    return this.repo.bindMaterialId(input);
  }

  findOwnedSource(sourceAssetId: string, userId: string) {
    return this.repo.findOwnedSource(sourceAssetId, userId);
  }

  findOwnedById(assetId: string, userId: string) {
    return this.repo.findOwnedById(assetId, userId);
  }

  findCommittedUpload(userId: string, storageKey: string) {
    return this.repo.findCommittedUpload(userId, storageKey);
  }

  createUploadedAsset(
    input: Parameters<ReturnType<typeof createAssetRepo>["createUploadedAsset"]>[0],
  ) {
    return this.repo.createUploadedAsset(input);
  }

  linkAssetToMaterial(input: {
    userId: string;
    assetId: string;
    materialId: string;
  }) {
    return this.repo.linkAssetToMaterial(input);
  }

  clearMaterialLink(userId: string, materialId: string) {
    return this.repo.clearMaterialLink(userId, materialId);
  }

  clearMaterialGroupLink(userId: string, materialGroupId: string) {
    return this.repo.clearMaterialGroupLink(userId, materialGroupId);
  }

  findBoundMaterialIds(userId: string, assetIds: readonly string[]) {
    return this.repo.findBoundMaterialIds(userId, assetIds);
  }

  findAccessible(assetId: string, userId: string) {
    return this.repo.findAccessible(assetId, userId);
  }

  async adminHardDelete(ids: string[]): Promise<{
    requested: number;
    deleted: number;
    blocked: string[];
    failed: string[];
  }> {
    const uniqueIds = [
      ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ].filter((id) => /^\d+$/.test(id));
    if (uniqueIds.length === 0) {
      throw new AdminException(400, "没有可删除的资产 ID");
    }

    const rows = await this.prisma.client.assets.findMany({
      where: { id: { in: uniqueIds.map((id) => BigInt(id)) } },
      select: { id: true, storage_key: true },
    });
    const byKey = new Map<string, bigint[]>();
    const validIds: bigint[] = [];
    const noKeyRows: bigint[] = [];
    for (const row of rows) {
      validIds.push(row.id);
      if (!row.storage_key) {
        noKeyRows.push(row.id);
        continue;
      }
      const ids = byKey.get(row.storage_key) ?? [];
      ids.push(row.id);
      byKey.set(row.storage_key, ids);
    }
    const invalidIds = uniqueIds.filter(
      (id) => !validIds.some((valid) => valid.toString() === id),
    );
    if (invalidIds.length > 0) {
      throw new AdminException(404, `资产不存在: ${invalidIds.join(", ")}`);
    }

    const storageKeys = [...byKey.keys()];
    const liveRefs = await this.repo.findLiveRefs(storageKeys);
    const blockedKeys = new Set(liveRefs);
    const keysToDelete = storageKeys.filter((key) => !blockedKeys.has(key));
    const blockedRows = rows.filter(
      (row) => row.storage_key && blockedKeys.has(row.storage_key),
    );
    const blocked = [
      ...blockedRows.map((row) => row.id.toString()),
      ...noKeyRows.map((id) => id.toString()),
    ];

    const failed: string[] = [];
    const deletedIds: bigint[] = [];
    if (keysToDelete.length > 0) {
      const uploads = this.storage.uploads;
      if (!uploads) {
        throw new AdminException(400, "对象存储未配置");
      }
      try {
        await uploads.deleteMultiObjects(keysToDelete);
        for (const key of keysToDelete) {
          deletedIds.push(...(byKey.get(key) ?? []));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`asset hard-delete deleteMultiObjects failed: ${message}`);
        failed.push(
          ...keysToDelete.flatMap((key) =>
            (byKey.get(key) ?? []).map((id) => id.toString()),
          ),
        );
      }
    }

    let deleted = 0;
    if (deletedIds.length > 0) {
      deleted = await this.repo.hardDeleteRows(deletedIds);
    }

    return {
      requested: uniqueIds.length,
      deleted,
      blocked,
      failed,
    };
  }
}
