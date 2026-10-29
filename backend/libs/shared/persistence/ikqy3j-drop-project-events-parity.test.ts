import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261027200000_ikqy3j_drop_project_events/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/077_ikqy3j_drop_project_events.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261027_ikqy3j_drop_project_events.sql", import.meta.url),
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

describe("IKQY3J 三轨迁移（删除项目事件表）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("迁移删除两张事件表", () => {
    expect(migrationSql).toContain("DROP TABLE IF EXISTS `project_events`");
    expect(migrationSql).toContain("DROP TABLE IF EXISTS `project_event_stream`");
  });

  it("Prisma 模型与 Java 测试 schema 均已移除", () => {
    expect(schemaPrisma).not.toContain("model project_events");
    expect(schemaPrisma).not.toContain("model project_event_stream");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `project_events`");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `project_event_stream`");
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).toContain("CREATE TABLE `project_events`");
    expect(baselineSql).not.toContain("DROP TABLE IF EXISTS `project_events`");
  });
});
