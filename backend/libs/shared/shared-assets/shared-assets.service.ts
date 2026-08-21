import { Inject, Injectable } from "@nestjs/common";
import {
  createSharedAssetRepo,
  type SharedAssetRepo,
  type SharedAssetRow,
} from "@blue-whale/persistence";
import {
  RESOURCE_NOT_FOUND_CODE,
  SHARED_ASSET_EMPTY_CARD_CODE,
  SHARED_ASSET_TYPE_UNSUPPORTED_CODE,
  sharedAssetSceneSnapshotSchema,
  type SaveSharedAssetRequest,
  type SaveSharedAssetResult,
  type SharedAssetListQuery,
  type SharedAssetPageView,
  type SharedAssetView,
} from "@blue-whale/contracts";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { SharedAssetTypeRegistry } from "./type/shared-asset-type.registry.js";
import { SharedAssetError } from "./shared-asset-error.js";
import {
  SHARED_ASSET_SOURCE_PORT,
  sharedAssetKindOf,
} from "./type/shared-asset-type.strategy.js";
import type { SharedAssetSourcePort } from "./shared-asset-source.port.js";

/** 共享资产应用服务：编排类型注册表（策略）与仓储。
 *  职责：保存（幂等兜底）、面板列表（type 过滤）、详情、删除、场景卡添加回画布（复制实体）。 */
@Injectable()
export class SharedAssetService {
  private repoInstance?: SharedAssetRepo;

  private get repo(): SharedAssetRepo {
    if (!this.repoInstance) {
      this.repoInstance = createSharedAssetRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SharedAssetTypeRegistry,
    @Inject(SHARED_ASSET_SOURCE_PORT)
    private readonly source: SharedAssetSourcePort,
  ) {}

  /** 保存到共享资产：策略校验 + 派生计划 → 落库；撞唯一键（幂等/去重/并发/删除后重存）→ 幂等返回或复活。 */
  async save(
    user: { userId: string },
    request: SaveSharedAssetRequest,
  ): Promise<SaveSharedAssetResult> {
    const strategy = this.registry.get(
      request.assetType,
      sharedAssetKindOf(request),
    );
    const plan = await strategy.buildSavePlan(user, request);
    try {
      const row = await this.repo.create({
        userId: user.userId,
        assetType: request.assetType,
        kind: sharedAssetKindOf(request),
        name: plan.name,
        thumbnailUrl: plan.thumbnailUrl,
        snapshot: plan.snapshot,
        dedupKey: plan.dedupKey,
      });
      return { created: true, item: this.toView(row) };
    } catch (error) {
      if (isUniqueViolation(error) && plan.dedupKey !== null) {
        const existing = await this.repo.findByDedupKey(
          user.userId,
          plan.dedupKey,
        );
        if (existing) return { created: false, item: this.toView(existing) };
        // 删除后重存：软删行仍占唯一键，查软删行并复活（is_delete 1→0，刷新快照）。
        const revived = await this.repo.reviveByDedupKey(user.userId, plan.dedupKey, {
          name: plan.name,
          thumbnailUrl: plan.thumbnailUrl,
          snapshot: plan.snapshot,
        });
        if (revived) return { created: true, item: this.toView(revived) };
        // 并发下复活可能被他人抢先：再查一次存活行。
        const existingAfter = await this.repo.findByDedupKey(
          user.userId,
          plan.dedupKey,
        );
        if (existingAfter) {
          return { created: false, item: this.toView(existingAfter) };
        }
      }
      throw error;
    }
  }

  /** 面板列表：asset_type/kind 双维过滤（缺省 = 全部）+ 分页，按创建时间倒序。 */
  async list(
    user: { userId: string },
    query: SharedAssetListQuery,
  ): Promise<SharedAssetPageView> {
    const page = await this.repo.listByUser(user.userId, {
      ...(query.assetType ? { assetType: query.assetType } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      page: query.page,
      size: query.size,
    });
    return {
      records: page.records.map((row) => this.toView(row)),
      total: page.total,
      size: page.size,
      current: page.current,
    };
  }

  /** 详情（添加回画布取全量快照）；不存在/不归属 → null。 */
  async detail(
    user: { userId: string },
    id: string,
  ): Promise<SharedAssetView | null> {
    const row = await this.repo.findById(user.userId, id);
    return row ? this.toView(row) : null;
  }

  /** 逻辑删除共享条目。 */
  async delete(user: { userId: string }, id: string): Promise<boolean> {
    return this.repo.softDeleteOwned(id, user.userId);
  }

  /** 场景卡添加回画布：把共享场景卡快照复制为目标项目的新 scene_cards 实体（含生成预设）。 */
  async addSceneToProject(
    user: { userId: string },
    sharedAssetId: string,
    projectId: string,
  ): Promise<{ sceneCardId: string }> {
    const row = await this.repo.findById(user.userId, sharedAssetId);
    if (!row) {
      throw new SharedAssetError(RESOURCE_NOT_FOUND_CODE, "共享资产不存在");
    }
    if (row.asset_type !== "scene") {
      throw new SharedAssetError(
        SHARED_ASSET_TYPE_UNSUPPORTED_CODE,
        "仅场景卡支持复制到项目",
      );
    }
    const parsed = sharedAssetSceneSnapshotSchema.safeParse(row.snapshot);
    if (!parsed.success) {
      throw new SharedAssetError(
        SHARED_ASSET_EMPTY_CARD_CODE,
        "场景卡快照数据不完整",
      );
    }
    const snapshot = parsed.data;
    const result = await this.source.copySceneCardToProject({
      userId: user.userId,
      projectId,
      title: snapshot.title,
      summary: snapshot.summary ?? null,
      content_markdown: snapshot.contentMarkdown,
      generation_preset: snapshot.generationPreset
        ? {
            parameters: snapshot.generationPreset.parameters,
            reference_mode: snapshot.generationPreset.referenceMode,
            reference_assets: snapshot.generationPreset.referenceAssets,
            capability_snapshot_version:
              snapshot.generationPreset.capabilitySnapshotVersion,
          }
        : null,
    });
    if (result.kind !== "copied") {
      throw new SharedAssetError(RESOURCE_NOT_FOUND_CODE, "目标项目不存在");
    }
    return { sceneCardId: result.scene_card_id };
  }

  private toView(row: SharedAssetRow): SharedAssetView {
    return {
      id: row.id.toString(),
      assetType: row.asset_type,
      kind: row.kind,
      name: row.name,
      thumbnailUrl: row.thumbnail_url,
      snapshot: row.snapshot,
      status: row.status as "normal" | "invalid",
      createdAt: row.gmt_create.toISOString(),
    };
  }
}

/** Prisma 唯一约束冲突（P2002，uk_shared_user_dedup）结构化判断，避免依赖运行时类型。 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
