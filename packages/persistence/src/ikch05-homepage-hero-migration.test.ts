import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260901142500_ikch05_homepage_hero/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../schema/012_ikch05_homepage_hero.sql", import.meta.url),
  "utf8",
);

describe("IKCH05 incremental migration", () => {
  it("creates homepage_hero with 官方草稿字段", () => {
    expect(migrationSql).toContain("CREATE TABLE `homepage_hero`");
    expect(migrationSql).toContain("`media_type` VARCHAR(16) NOT NULL DEFAULT 'video'");
    expect(migrationSql).toContain("`media_url` VARCHAR(512) NOT NULL");
    expect(migrationSql).toContain("`poster_url` VARCHAR(512) NULL");
    expect(migrationSql).toContain("`sort_order` INTEGER NOT NULL DEFAULT 0");
    expect(migrationSql).toContain("`enabled` TINYINT NOT NULL DEFAULT 1");
    expect(migrationSql).toContain("INDEX `idx_hero_enabled_sort`(`enabled`, `is_delete`, `sort_order`)");
    expect(migrationSql).toContain("INDEX `idx_hero_sort`(`sort_order`, `is_delete`)");
  });

  it("baseline 必须同步：fresh-MySQL 只加载 baseline，缺表会让首页/后台 500", () => {
    expect(baselineSql).toContain("CREATE TABLE `homepage_hero`");
    expect(baselineSql).toContain("`media_type` VARCHAR(16) NOT NULL DEFAULT 'video'");
    expect(baselineSql).toContain("INDEX `idx_hero_enabled_sort`(`enabled`, `is_delete`, `sort_order`)");
  });

  it("standalone schema/012 与 migration 的 DDL 一致", () => {
    expect(standaloneSql).toContain("CREATE TABLE `homepage_hero`");
    expect(standaloneSql).toContain("`poster_url` VARCHAR(512) NULL");
    expect(standaloneSql).toContain("INDEX `idx_hero_sort`(`sort_order`, `is_delete`)");
    expect(standaloneSql).toContain("DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
  });
});
