import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261028150000_ikqy3k_drop_conversations/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/080_ikqy3k_drop_conversations.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261028_ikqy3k_drop_conversations.sql", import.meta.url),
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

describe("IKQY3K 三轨迁移（删除 conversations）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("迁移删除 conversations 表", () => {
    expect(migrationSql).toContain("DROP TABLE IF EXISTS `conversations`");
  });

  it("Prisma 模型与 Java 测试 schema 均已移除", () => {
    expect(schemaPrisma).not.toContain("model conversations {");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `conversations`");
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).toContain("CREATE TABLE `conversations`");
    expect(baselineSql).not.toContain("DROP TABLE IF EXISTS `conversations`");
  });
});
