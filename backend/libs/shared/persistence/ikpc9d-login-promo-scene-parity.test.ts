import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261021160000_ikpc9d_login_promo_scene/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/073_ikpc9d_login_promo_scene.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261021_ikpc9d_login_promo_scene.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("homepage_hero 场景字段三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(migrationSql).toContain("SET NAMES utf8mb4");
  });

  it("scene 列默认 homepage，存量行自动归入首页场景", () => {
    expect(migrationSql).toContain(
      "ADD COLUMN `scene` VARCHAR(20) NOT NULL DEFAULT 'homepage'",
    );
  });

  it("场景索引列顺序与查询一致：scene → enabled → is_delete → sort_order", () => {
    expect(migrationSql).toContain(
      "ADD INDEX `idx_hero_scene_enabled_sort` (`scene`, `enabled`, `is_delete`, `sort_order`)",
    );
  });

  it("schema.prisma 同步 scene 与索引", () => {
    expect(schemaPrisma).toContain(
      'scene        String   @default("homepage") @db.VarChar(20)',
    );
    expect(schemaPrisma).toContain(
      '@@index([scene, enabled, is_delete, sort_order], map: "idx_hero_scene_enabled_sort")',
    );
  });
});
