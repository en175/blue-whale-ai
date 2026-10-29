import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029160000_ikrgtj_material_info_and_drop_shared_assets/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/086_ikrgtj_material_info_and_drop_shared_assets.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20261029_ikrgtj_material_info_and_drop_shared_assets.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

const statementsOf = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));

describe("素材组表归位与共享资产快照退役（IKRGTJ）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("只做删除共享快照表与素材组改名两条语句", () => {
    for (const sql of TRACKS) {
      expect(statementsOf(sql)).toEqual([
        "SET NAMES utf8mb4;",
        "DROP TABLE IF EXISTS `user_shared_asset_snapshots`;",
        "RENAME TABLE `catalog_material_groups` TO `user_material_info`;",
      ]);
    }
  });

  it("不重复改名 ADR-0135 已改过的索引", () => {
    for (const sql of TRACKS) {
      expect(sql).not.toContain("RENAME INDEX");
      expect(sql).not.toContain("uk_material_group_user_upstream");
      expect(sql).not.toContain("idx_material_group_user_kind");
      expect(sql).not.toContain("idx_material_group_user_alive");
    }
  });

  it("Prisma 模型与新表名一致，旧模型已删除", () => {
    expect(schemaPrisma).toContain("model user_material_info {");
    expect(schemaPrisma).not.toContain("model catalog_material_groups {");
    expect(schemaPrisma).not.toContain("model user_shared_asset_snapshots {");
  });
});
