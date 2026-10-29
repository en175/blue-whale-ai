import { wallClockRfc3339 } from "@lib/core";
import { Injectable } from "@nestjs/common";
import {
  createSharedAssetRepo,
  type SharedAssetRepo,
  type SharedAssetRow,
} from "@lib/shared/persistence/index.js";
import {
  type SaveSharedAssetRequest,
  type SaveSharedAssetResult,
  type SharedAssetListQuery,
  type SharedAssetPageView,
  type SharedAssetView,
} from "@lib/contracts";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { SharedAssetTypeRegistry } from "./type/shared-asset-type.registry.js";
import { sharedAssetKindOf } from "./type/shared-asset-type.strategy.js";

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
  ) {}

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
        const revived = await this.repo.reviveByDedupKey(user.userId, plan.dedupKey, {
          name: plan.name,
          thumbnailUrl: plan.thumbnailUrl,
          snapshot: plan.snapshot,
        });
        if (revived) return { created: true, item: this.toView(revived) };
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

  async detail(
    user: { userId: string },
    id: string,
  ): Promise<SharedAssetView | null> {
    const row = await this.repo.findById(user.userId, id);
    return row ? this.toView(row) : null;
  }

  async delete(user: { userId: string }, id: string): Promise<boolean> {
    return this.repo.softDeleteOwned(id, user.userId);
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
      createdAt: wallClockRfc3339(row.gmt_create),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
