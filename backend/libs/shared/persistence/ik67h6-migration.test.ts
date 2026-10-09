import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260805120000_ik67h6_plan_message/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H6 incremental migration", () => {
  it("adds content_type to conversation_messages for the plan_message subtype", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `conversation_messages` ADD COLUMN `content_type` VARCHAR(24) NOT NULL DEFAULT 'text'",
    );
    expect(baselineSql).toContain(
      "`content_type` VARCHAR(24) NOT NULL DEFAULT 'text'",
    );
  });


  it("creates the plan_messages table for frozen PlanMessage state", () => {
    expect(migrationSql).toContain("CREATE TABLE `plan_messages`");
    expect(migrationSql).toContain(
      "`content_markdown` LONGTEXT NOT NULL",
    );
    expect(migrationSql).toContain(
      "`derived_references` JSON NOT NULL",
    );
    expect(migrationSql).toContain(
      "`frozen_generation_parameters` JSON NOT NULL",
    );
    expect(migrationSql).toContain(
      "`capability_snapshot_version` JSON NOT NULL",
    );
    expect(migrationSql).toContain(
      "`provider_prompt_projection` JSON NOT NULL",
    );
    expect(migrationSql).toContain(
      "`application_kind` VARCHAR(32) NOT NULL",
    );
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_plan_message_message`(`message_id`)",
    );
    expect(baselineSql).toContain("CREATE TABLE `plan_messages`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_message_message`(`message_id`)",
    );
  });
});
