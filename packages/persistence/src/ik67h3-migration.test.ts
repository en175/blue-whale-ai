import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260804200000_ik67h3_mention_input_snapshot/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H3 incremental migration", () => {
  it("adds the mention_input_snapshot column for per-advance MentionInputSnapshot freezing", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `agent_advances` ADD COLUMN `mention_input_snapshot` JSON NULL",
    );
    // baseline 必须同步：fresh-MySQL 只加载 baseline，缺列会让黑盒拓扑全线红。
    expect(baselineSql).toContain("`mention_input_snapshot` JSON NULL");
  });
});
