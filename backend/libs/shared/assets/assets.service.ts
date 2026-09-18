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

  /** IKCNLP（方案C）：素材-项目关联（幂等 upsert）。 */
  linkAssetToProject(input: { userId: string; assetId: string; projectId: string }) {
    return this.repo.linkAssetToProject(input);
  }

  /** IKCZAT：查询素材被多少项目引用（直接归属 ∪ project_asset，并集去重）。 */
  countReferencingProjects(assetId: string, userId: string) {
    return this.repo.countReferencingProjects(assetId, userId);
  }

  /** IKCNLS：上传 md5 去重——查该用户未删同 md5 最新资产。 */
  findOwnedByMd5(userId: string, md5: string) {
    return this.repo.findOwnedByMd5(userId, md5);
  }

  findOwnedByMaterialId(userId: string, materialId: string) {
    return this.repo.findOwnedByMaterialId(userId, materialId);
  }

  /** IKGQWR：绑素材库素材到本地资产（覆盖写，两列一起；ADR-0093 决策 5）。 */
  bindMaterialId(input: {
    userId: string;
    assetId: string;
    materialId: string;
    materialGroupId: string | null;
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

  /** IKDJNZ：素材库素材创建成功后，绑定原始素材 ↔ 素材库素材（覆盖写）。 */
  linkAssetToMaterial(input: {
    userId: string;
    assetId: string;
    materialId: string;
    materialGroupId: string;
  }) {
    return this.repo.linkAssetToMaterial(input);
  }

  /** IKDJNZ：素材库素材删除后，清除本地 assets 的 material_id 关联。 */
  clearMaterialLink(userId: string, materialId: string) {
    return this.repo.clearMaterialLink(userId, materialId);
  }

  /** IKDJNZ：素材库组删除后，按组批量清除本地 assets 的 material 关联。 */
  clearMaterialGroupLink(userId: string, materialGroupId: string) {
    return this.repo.clearMaterialGroupLink(userId, materialGroupId);
  }

  /** IKF YHJ：查这批本地 Asset 里已绑素材库素材的 material_id（生成创建期素材门用）。 */
  findBoundMaterialIds(userId: string, assetIds: readonly string[]) {
    return this.repo.findBoundMaterialIds(userId, assetIds);
  }

  findAccessible(assetId: string, userId: string) {
    return this.repo.findAccessible(assetId, userId);
  }

  insertCopy(
    projectId: string,
    userId: string,
    source: Parameters<ReturnType<typeof createAssetRepo>["insertCopy"]>[2],
  ) {
    return this.repo.insertCopy(projectId, userId, source);
  }

  /** IKBMDM 管理后台强删：对任意 id 集合做引用核对后物理回收 TOS 对象并删除行。 */
  async adminHardDelete(ids: string[]): Promise<{
    requested: number;
    deleted: number;
    blocked: string[];
    failed: string[];
  }> {
    // 只接受十进制正整数 id；非法输入在落到 BigInt 前拦下（IKBMDM F5）。
    const uniqueIds = [
      ...new Set(ids.map((id) => id.trim()).filter(Boolean)),
    ].filter((id) => /^\d+$/.test(id));
    if (uniqueIds.length === 0) {
      // 非法 id 属请求错误，返回 400 而非 500（G2：AdminException 由过滤器映射为 {success:false,error}）。
      throw new AdminException(400, "没有可删除的资产 ID");
    }

    const rows = await this.prisma.client.assets.findMany({
      where: { id: { in: uniqueIds.map((id) => BigInt(id)) } },
      select: { id: true, storage_key: true },
    });
    const byKey = new Map<string, bigint[]>();
    const validIds: bigint[] = [];
    // storage_key 为 NULL 的行：没有对应 TOS 对象可回收，属脏数据。不静默丢弃——
    // 计入 blocked 对外可见，行保留待人工处置（G3）。
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
        // 与 GC 同因（G2）：配置缺失时请求本身不可执行，抛 AdminException 而非 500。
        throw new AdminException(400, "对象存储未配置");
      }
      try {
        // 共享 storage_key 的多行一批删（TOS 批量接口），避免逐行 deleteObject 的 N+1。
        await uploads.deleteMultiObjects(keysToDelete);
        for (const key of keysToDelete) {
          deletedIds.push(...(byKey.get(key) ?? []));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 批量部分失败时无法从 TOS 错误响应定位具体失败 key，整批记为 failed，行保留待重试（F3/F6）。
        // 注意：failed 可能包含实际已删除成功的对象（口径高报）——重试幂等，404 视为成功，无孤儿行/悬空引用。
        // 强删属安全关键写操作，审计失败不允许静默吞掉，至少上报日志（ADR-0018 §6）。
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
