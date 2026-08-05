import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260805160000_ik67h8_plan_application_receipt/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
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
    // baseline 必须同步：fresh-MySQL 只加载 baseline，缺列会让黑盒拓扑全线红。
    expect(baselineSql).toContain("`applied_at` DATETIME(0) NULL");
    expect(baselineSql).toContain("`first_generation_job_id` BIGINT NULL");
  });

  it("extends IK67H9 receipts table with image-path columns (conversation/agent-run)", () => {
    // IK67H9 已建 plan_application_receipts；T10 只补图片分支所需的会话/运行归属列，不重复建表。
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_application_receipts` ADD COLUMN `conversation_id` BIGINT NULL",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `plan_application_receipts` ADD COLUMN `agent_run_id` BIGINT NULL",
    );
    expect(migrationSql).not.toContain("CREATE TABLE `plan_application_receipts`");
    // baseline 双写：receipts 表含两列，at-most-once 唯一键沿用 IK67H9 的 uk(message_id)。
    expect(baselineSql).toContain("`conversation_id` BIGINT NULL");
    expect(baselineSql).toContain("`agent_run_id` BIGINT NULL");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt_message`(`message_id`)",
    );
  });
});
