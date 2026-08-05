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

  it("creates plan_application_receipts with uk(plan_message_id) at-most-once guard", () => {
    expect(migrationSql).toContain("CREATE TABLE `plan_application_receipts`");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt`(`plan_message_id`)",
    );
    expect(migrationSql).toContain(
      "`first_generation_job_id` BIGINT NOT NULL",
    );
    expect(migrationSql).toContain("`content_digest` VARCHAR(80) NOT NULL");
    expect(migrationSql).toContain("`idempotency_key` VARCHAR(128) NOT NULL");
    // 视频分支字段本期预留 nullable，图片路径不填。
    expect(migrationSql).toContain("`scene_card_id` BIGINT NULL");
    // baseline 双写
    expect(baselineSql).toContain("CREATE TABLE `plan_application_receipts`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt`(`plan_message_id`)",
    );
  });
});
