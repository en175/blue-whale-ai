import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260902000000_ikckow_drop_old_agent_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/013_ikckow_drop_old_agent_tables.sql", import.meta.url),
  "utf8",
);

const DROPPED_TABLES = [
  "user_input_requests",
  "agent_provider_calls",
  "agent_provisional_chunks",
  "agent_provisional_deliveries",
  "run_commits",
  "agent_advances",
];
const KEPT_TABLES = ["agent_runs"];

describe("IKCKOW 双轨迁移（删除 6 张旧 Agent 运行表）", () => {
  it.each(DROPPED_TABLES)("两轨都 DROP 旧表 %s", (table) => {
    expect(migrationSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
    expect(standaloneSql).toContain(`DROP TABLE IF EXISTS \`${table}\``);
  });

  it("standalone 含 SET NAMES utf8mb4（对齐 010 先例）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it.each(KEPT_TABLES)("保留表 %s 不落入任何 DROP", (table) => {
    expect(migrationSql).not.toContain(`DROP TABLE IF EXISTS \`${table}\``);
    expect(standaloneSql).not.toContain(`DROP TABLE IF EXISTS \`${table}\``);
  });

  it("baseline 不再建 6 张旧表、保留 agent_runs", () => {
    for (const table of DROPPED_TABLES) {
      expect(baselineSql).not.toContain(`CREATE TABLE \`${table}\``);
    }
    for (const table of KEPT_TABLES) {
      expect(baselineSql).toContain(`CREATE TABLE \`${table}\``);
    }
  });
});
