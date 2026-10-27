import type { PrismaClient } from "@prisma/client";

import { swapSequence, type MoveDirection } from "./template-admin-repo.js";


export class HomepageHeroLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HomepageHeroLimitError";
  }
}

export const HOMEPAGE_HERO_MAX_ENABLED = 8;

export const HOMEPAGE_HERO_SCENES = ["homepage", "auth"] as const;
export type HomepageHeroScene = (typeof HOMEPAGE_HERO_SCENES)[number];

export function isHomepageHeroScene(value: unknown): value is HomepageHeroScene {
  return (
    typeof value === "string" &&
    (HOMEPAGE_HERO_SCENES as readonly string[]).includes(value)
  );
}

export interface HomepageHeroAdminView {
  id: string;
  scene: string;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
  enabled: number;
  created_at: Date;
  updated_at: Date;
}

export interface HomepageHeroPublicView {
  id: string;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
}

export interface CreateHomepageHeroInput {
  scene: HomepageHeroScene;
  media_type: string;
  media_url: string;
  poster_url?: string | null;
  sort_order?: number;
  enabled?: number;
}

export type UpdateHomepageHeroInput = Partial<Omit<CreateHomepageHeroInput, "scene">>;

export interface HomepageHeroRepo {
  listAll(scene: HomepageHeroScene): Promise<HomepageHeroAdminView[]>;
  listEnabled(scene: HomepageHeroScene): Promise<HomepageHeroPublicView[]>;
  getById(id: bigint): Promise<HomepageHeroAdminView | null>;
  create(input: CreateHomepageHeroInput): Promise<string>;
  update(id: bigint, input: UpdateHomepageHeroInput): Promise<boolean>;
  softDelete(id: bigint): Promise<boolean>;
  move(id: bigint, direction: MoveDirection): Promise<MoveResult>;
  countEnabled(scene: HomepageHeroScene): Promise<number>;
}

export interface MoveResult {
  ok: boolean;
  reason?: "not_found" | "boundary" | "limit";
}

function toAdminView(row: {
  id: bigint;
  scene: string;
  media_type: string;
  media_url: string;
  poster_url: string | null;
  sort_order: number;
  enabled: number;
  gmt_create: Date;
  gmt_modified: Date;
}): HomepageHeroAdminView {
  return {
    id: row.id.toString(),
    scene: row.scene,
    media_type: row.media_type,
    media_url: row.media_url,
    poster_url: row.poster_url,
    sort_order: row.sort_order,
    enabled: row.enabled,
    created_at: row.gmt_create,
    updated_at: row.gmt_modified,
  };
}

export function createHomepageHeroRepo(prisma: PrismaClient): HomepageHeroRepo {
  return {
    async listAll(scene) {
      const rows = await prisma.content_homepage_heroes.findMany({
        where: { is_delete: 0, scene },
        orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      });
      return rows.map(toAdminView);
    },

    async listEnabled(scene) {
      const rows = await prisma.content_homepage_heroes.findMany({
        where: { is_delete: 0, enabled: 1, scene },
        orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        select: {
          id: true,
          media_type: true,
          media_url: true,
          poster_url: true,
          sort_order: true,
        },
      });
      return rows.map((row) => ({
        id: row.id.toString(),
        media_type: row.media_type,
        media_url: row.media_url,
        poster_url: row.poster_url,
        sort_order: row.sort_order,
      }));
    },

    async getById(id) {
      const row = await prisma.content_homepage_heroes.findFirst({
        where: { id, is_delete: 0 },
      });
      return row ? toAdminView(row) : null;
    },

    async create(input) {
      return prisma.$transaction(async (tx) => {
        const enabling = input.enabled ?? 1;
        if (enabling === 1) {
          const enabledCount = await tx.content_homepage_heroes.count({
            where: { is_delete: 0, enabled: 1, scene: input.scene },
          });
          if (enabledCount + 1 > HOMEPAGE_HERO_MAX_ENABLED) {
            throw new HomepageHeroLimitError(
              `启用条目已达上限 ${HOMEPAGE_HERO_MAX_ENABLED} 条`,
            );
          }
        }
        let sortOrder = input.sort_order;
        if (sortOrder === undefined) {
          const agg = await tx.content_homepage_heroes.aggregate({
            where: { is_delete: 0, scene: input.scene },
            _max: { sort_order: true },
          });
          sortOrder = (agg._max.sort_order ?? -1) + 1;
        }
        const now = new Date();
        const row = await tx.content_homepage_heroes.create({
          data: {
            scene: input.scene,
            media_type: input.media_type,
            media_url: input.media_url,
            poster_url: input.poster_url ?? null,
            sort_order: sortOrder,
            enabled: enabling,
            gmt_modified: now,
          },
        });
        return row.id.toString();
      });
    },

    async update(id, input) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.content_homepage_heroes.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!existing) return false;

        const targetEnabled = input.enabled ?? existing.enabled;
        if (existing.enabled === 0 && targetEnabled === 1) {
          const enabledCount = await tx.content_homepage_heroes.count({
            where: { is_delete: 0, enabled: 1, scene: existing.scene },
          });
          if (enabledCount + 1 > HOMEPAGE_HERO_MAX_ENABLED) {
            throw new HomepageHeroLimitError(
              `启用条目已达上限 ${HOMEPAGE_HERO_MAX_ENABLED} 条`,
            );
          }
        }

        await tx.content_homepage_heroes.update({
          where: { id },
          data: {
            media_type: input.media_type ?? existing.media_type,
            media_url: input.media_url ?? existing.media_url,
            poster_url:
              input.poster_url !== undefined ? input.poster_url : existing.poster_url,
            sort_order: input.sort_order ?? existing.sort_order,
            enabled: targetEnabled,
            gmt_modified: new Date(),
          },
        });
        return true;
      });
    },

    async softDelete(id) {
      const result = await prisma.content_homepage_heroes.updateMany({
        where: { id, is_delete: 0 },
        data: { is_delete: 1, gmt_modified: new Date() },
      });
      return result.count > 0;
    },

    async move(id, direction) {
      return prisma.$transaction(async (tx) => {
        const target = await tx.content_homepage_heroes.findFirst({
          where: { id, is_delete: 0 },
        });
        if (!target) return { ok: false, reason: "not_found" as const };

        const siblings = await tx.content_homepage_heroes.findMany({
          where: { is_delete: 0, scene: target.scene },
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
        });
        const idx = siblings.findIndex((r) => r.id === id);
        const swapped = swapSequence(siblings, idx, direction);
        if (!swapped) return { ok: false, reason: "boundary" as const };
        await Promise.all(
          swapped.map((row, i) =>
            row.sort_order === i
              ? Promise.resolve()
              : tx.content_homepage_heroes.update({
                  where: { id: row.id },
                  data: { sort_order: i, gmt_modified: new Date() },
                }),
          ),
        );
        return { ok: true };
      });
    },

    async countEnabled(scene) {
      return prisma.content_homepage_heroes.count({
        where: { is_delete: 0, enabled: 1, scene },
      });
    },
  };
}
