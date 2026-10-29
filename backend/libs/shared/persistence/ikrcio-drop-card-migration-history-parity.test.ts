import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029090000_ikrcio_drop_card_migration_history/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/084_ikrcio_drop_card_migration_history.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrcio_drop_card_migration_history.sql", import.meta.url),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
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

describe("IKRCIO 三轨迁移（删除旧卡迁移历史表）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("迁移删除 project_card_migration_history", () => {
    expect(migrationSql).toContain("DROP TABLE IF EXISTS `project_card_migration_history`");
    expect(migrationSql).toContain("DROP TABLE IF EXISTS `legacy_card_history`");
  });

  it("Prisma 模型与 Java 测试 schema 均已移除", () => {
    expect(schemaPrisma).not.toContain("model project_card_migration_history {");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `project_card_migration_history`");
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).not.toContain("DROP TABLE IF EXISTS `project_card_migration_history`");
  });
});
