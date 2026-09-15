import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ADR-0087 / IKF YHJ：素材校验状态镜像（material_assets）+ 网关执行凭证（user_info）。
// 镜像 ikckow/ikeefv-parity 的双轨核对结构：schema 基线片段、prisma migration、docs/sql 快照三处同源。

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

const NEW_TABLES = ["material_assets", "user_info"];

/** 表定义块（CREATE TABLE `<name>` ... 到分号）。 */
function tableBlock(sql: string, table: string): string | undefined {
  return sql.match(new RegExp("CREATE TABLE `" + table + "`[^;]*;"))?.[0];
}

/** 表内反引号列名集合（排除索引名）。 */
function columnsIn(block: string): string[] {
  return [...block.matchAll(/^\s+`([a-z_]+)`\s/gm)].map((m) => m[1]).sort();
}

describe("IKFYHJ 双轨迁移（素材校验状态镜像 + 网关执行凭证）", () => {
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

  it("schema.prisma 同步两个 model 与关键唯一键", () => {
    for (const table of NEW_TABLES) {
      expect(schemaPrisma).toContain("model " + table + " ");
    }
    expect(schemaPrisma).toContain('uk_material_assets_material');
    expect(schemaPrisma).toContain('uk_user_info_user');
  });

  it("user_info 只存凭证，不含任何用户资料列", () => {
    const columns = columnsIn(tableBlock(migrationSql, "user_info")!);
    expect(columns).toEqual([
      "gmt_create",
      "gmt_modified",
      "id",
      "provider_credential",
      "user_id",
      "version",
    ]);
  });
});
