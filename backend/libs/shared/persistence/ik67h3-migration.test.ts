import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260804200000_ik67h3_mention_input_snapshot/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H3 incremental migration", () => {
  it("adds the mention_input_snapshot column for per-advance MentionInputSnapshot freezing", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `agent_advances` ADD COLUMN `mention_input_snapshot` JSON NULL",
    );
    // IKCKOW：agent_advances 表已随旧 Agent 引擎删除，fresh 库只加载 baseline，
    // baseline 不再含该列 —— 历史 migration 文件保留原样仅作升级链记录。
    expect(baselineSql).not.toContain("`mention_input_snapshot` JSON NULL");
    expect(baselineSql).not.toContain("CREATE TABLE `agent_advances`");
  });
});
