import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029180000_ikrifx_swap_material_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/088_ikrifx_swap_material_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrifx_swap_material_tables.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const javaSchemaSql = readFileSync(
  new URL(
    "../../../../server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql",
    import.meta.url,
  ),
  "utf8",
);
const javaMapperSql = readFileSync(
  new URL(
    "../../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/persistence/mapper/MaterialAssetMapper.java",
    import.meta.url,
  ),
  "utf8",
);

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

const statementsOf = (sql: string) =>
  sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));

describe("素材域表名对调修正（IKRIFX）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("索引改名在前，两张表一条多表 RENAME 在后", () => {
    for (const sql of TRACKS) {
      const statements = statementsOf(sql);
      expect(statements).toHaveLength(3);
      expect(statements[1].startsWith("ALTER TABLE `catalog_material_states`")).toBe(true);
      expect(statements[2]).toContain("RENAME TABLE `user_material_info` TO `user_material_groups`");
      expect(statements[2]).toContain("`catalog_material_states` TO `user_material_info`");
      expect(sql.indexOf("RENAME TABLE")).toBeGreaterThan(sql.lastIndexOf("RENAME INDEX"));
    }
  });

  it("三条旧索引名逐条改到新表名下", () => {
    for (const sql of TRACKS) {
      for (const [from, to] of [
        ["uk_catalog_material_states__material", "uk_user_material_info__material"],
        ["idx_catalog_material_states__poll", "idx_user_material_info__poll"],
        ["idx_catalog_material_states__group", "idx_user_material_info__group"],
      ]) {
        expect(sql).toContain("RENAME INDEX `" + from + "` TO `" + to + "`");
      }
    }
  });

  it("Prisma 模型、索引 map 与 Java schema/mapper 同步新表名", () => {
    expect(schemaPrisma).toContain("model user_material_groups {");
    expect(schemaPrisma).toContain("model user_material_info {");
    expect(schemaPrisma).not.toContain("model catalog_material_states {");
    expect(schemaPrisma).toContain('"uk_user_material_info__material"');
    expect(schemaPrisma).toContain('"idx_user_material_info__poll"');
    expect(schemaPrisma).toContain('"idx_user_material_info__group"');
    expect(javaSchemaSql).toContain("CREATE TABLE `user_material_groups`");
    expect(javaSchemaSql).toContain("CREATE TABLE `user_material_info`");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `catalog_material_states`");
    expect(javaMapperSql).toContain("user_material_info");
    expect(javaMapperSql).not.toContain("catalog_material_states");
  });
});
