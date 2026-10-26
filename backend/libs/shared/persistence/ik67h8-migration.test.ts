import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260805160000_ik67h8_plan_application_receipt/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H8 incremental migration", () => {
  it("adds applied_at + first_generation_job_id to plan_messages", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_messages` ADD COLUMN `applied_at` DATETIME(0) NULL",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_messages` ADD COLUMN `first_generation_job_id` BIGINT NULL",
    );
    expect(baselineSql).toContain("`applied_at` DATETIME(0) NULL");
    expect(baselineSql).toContain("`first_generation_job_id` BIGINT NULL");
  });

  it("extends IK67H9 receipts table with image-path columns (conversation/agent-run)", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_application_receipts` ADD COLUMN `conversation_id` BIGINT NULL",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_application_receipts` ADD COLUMN `agent_run_id` BIGINT NULL",
    );
    expect(migrationSql).not.toContain("CREATE TABLE `plan_application_receipts`");
    expect(baselineSql).toContain("`conversation_id` BIGINT NULL");
    expect(baselineSql).toContain("`agent_run_id` BIGINT NULL");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt_message`(`message_id`)",
    );
  });
});
