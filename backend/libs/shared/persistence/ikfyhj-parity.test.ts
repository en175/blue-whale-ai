import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260915170000_ikfyhj_material_compliance/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/025_ikfyhj_material_compliance.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260915_ikfyhj_material_compliance.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const dropMigrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929000000_drop_user_info/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const dropStandaloneSql = readFileSync(
  new URL("../../../prisma/schema/055_drop_user_info.sql", import.meta.url),
  "utf8",
);
const dropSnapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_drop_user_info.sql", import.meta.url),
  "utf8",
);

const NEW_TABLES = ["material_assets"];

function tableBlock(sql: string, table: string): string | undefined {
  return sql.match(new RegExp("CREATE TABLE `" + table + "`[^;]*;"))?.[0];
}

function columnsIn(block: string): string[] {
  return [...block.matchAll(/^\s+`([a-z_]+)`\s/gm)].map((m) => m[1]).sort();
}

describe("IKFYHJ 双轨迁移（素材校验状态镜像）", () => {
  it.each(NEW_TABLES)("三处都建表 %s", (table) => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain("CREATE TABLE `" + table + "`");
    }
  });

  it("schema 基线片段含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it.each(NEW_TABLES)("%s 列集合三轨一致", (table) => {
    const migration = tableBlock(migrationSql, table);
    const standalone = tableBlock(standaloneSql, table);
    const snapshot = tableBlock(snapshotSql, table);
    expect(migration).toBeDefined();
    expect(standalone).toBeDefined();
    expect(snapshot).toBeDefined();
    const expected = columnsIn(migration!);
    expect(expected.length).toBeGreaterThan(0);
    expect(columnsIn(standalone!)).toEqual(expected);
    expect(columnsIn(snapshot!)).toEqual(expected);
  });

  it("material_assets 无 is_delete/deleted_at（ADR-0087 决策 5：硬删，不做软删）", () => {
    const block = tableBlock(migrationSql, "material_assets")!;
    expect(block).not.toContain("is_delete");
    expect(block).not.toContain("deleted_at");
  });

  it("定时兜底所需的轮询索引存在（status + gmt_create）", () => {
    expect(migrationSql).toContain(
      "KEY `idx_material_assets_poll` (`status`, `gmt_create`)",
    );
  });

  it("schema.prisma 同步 model 与关键唯一键", () => {
    expect(schemaPrisma).toContain("model user_material_info ");
    expect(schemaPrisma).toContain("uk_user_material_info__material");
  });
});

describe("user_info 退役（网关执行凭证镜像）", () => {
  it("三轨都 DROP TABLE `user_info`", () => {
    for (const sql of [dropMigrationSql, dropStandaloneSql, dropSnapshotSql]) {
      expect(sql).toContain("DROP TABLE IF EXISTS `user_info`");
      expect(sql).toContain("SET NAMES utf8mb4");
    }
  });

  it("三轨逐字同源", () => {
    expect(dropStandaloneSql).toBe(dropMigrationSql);
    expect(dropSnapshotSql).toBe(dropMigrationSql);
  });

  it("schema.prisma 不再有 model user_info", () => {
    expect(schemaPrisma).not.toContain("model user_info");
  });
});
