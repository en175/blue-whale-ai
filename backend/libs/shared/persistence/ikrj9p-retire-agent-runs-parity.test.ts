import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029190000_ikrj9p_retire_agent_runs_and_bw_media_tools/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/089_ikrj9p_retire_agent_runs_and_bw_media_tools.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20261029_ikrj9p_retire_agent_runs_and_bw_media_tools.sql",
    import.meta.url,
  ),
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

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

const statementsOf = (sql: string) =>
  sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0 && !statement.startsWith("--"));

describe("退役 agent_runs 与媒体工具表归位（IKRJ9P）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("索引改名在先，表改名与删表随后", () => {
    for (const sql of TRACKS) {
      expect(statementsOf(sql)).toEqual([
        "SET NAMES utf8mb4",
        "ALTER TABLE `catalog_media_tools` RENAME INDEX `uk_catalog_media_tools__tool_type` TO `uk_bw_media_tools__tool_type`",
        "RENAME TABLE `catalog_media_tools` TO `bw_media_tools`",
        "DROP TABLE IF EXISTS `agent_runs`",
      ]);
    }
  });

  it("Prisma 模型同步：媒体工具改名、agent_runs 下线", () => {
    expect(schemaPrisma).toContain("model bw_media_tools {");
    expect(schemaPrisma).not.toContain("model catalog_media_tools {");
    expect(schemaPrisma).toContain('"uk_bw_media_tools__tool_type"');
    expect(schemaPrisma).not.toContain("model agent_runs {");
  });

  it("Java 测试 schema 不再建 agent_runs", () => {
    expect(javaSchemaSql).not.toContain("CREATE TABLE `agent_runs`");
  });
});
