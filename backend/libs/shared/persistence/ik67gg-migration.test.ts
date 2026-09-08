import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260804020000_ik67gg_frozen_agent_runtime/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("IK67GG incremental migration", () => {
  it("upgrades an existing agent_runs schema and creates both runtime fact tables", () => {
    expect(migrationSql).toContain("ALTER TABLE `agent_runs`");
    expect(migrationSql).toContain("ADD COLUMN `run_pin` JSON NULL");
    expect(migrationSql).toContain(
      "ADD COLUMN `activated_creative_skill_versions` JSON NULL",
    );
    expect(migrationSql).toContain(
      "ADD COLUMN `reasoning_summary` VARCHAR(280) NULL",
    );
    expect(migrationSql).toContain("CREATE TABLE `agent_advances`");
    expect(migrationSql).toContain("CREATE TABLE `run_commits`");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_agent_advance_run`(`agent_run_id`)",
    );
  });
});
