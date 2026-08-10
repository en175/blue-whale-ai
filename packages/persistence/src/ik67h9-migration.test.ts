import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260805130000_ik67h9_plan_application/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H9 incremental migration", () => {
  it("creates immutable plan_application_receipts with the per-message + per-command uniques", () => {
    expect(migrationSql).toContain("CREATE TABLE `plan_application_receipts`");
    expect(migrationSql).toContain("`scene_card_id` BIGINT NULL");
    expect(migrationSql).toContain("`application_kind` VARCHAR(32) NOT NULL");
    expect(migrationSql).toContain("`command_id` VARCHAR(128) NOT NULL");
    // 不可变事实：无 gmt_modified / version 列
    expect(migrationSql).toContain("`applied_at` DATETIME(0) NOT NULL");
    // 每条 PlanMessage 最多一次成功应用（CONTEXT L227）
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt_message`(`message_id`)",
    );
    // 同 CommandId 只返回首次结果
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_plan_application_command`(`project_id`, `command_id`)",
    );
    // baseline 双写
    expect(baselineSql).toContain("CREATE TABLE `plan_application_receipts`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_application_receipt_message`(`message_id`)",
    );
  });

  it("creates scene_card_generation_presets 1:1 with scene_card (uk_preset_scene)", () => {
    expect(migrationSql).toContain("CREATE TABLE `scene_card_generation_presets`");
    expect(migrationSql).toContain("`reference_mode` VARCHAR(32) NOT NULL");
    expect(migrationSql).toContain("`parameters` JSON NOT NULL");
    expect(migrationSql).toContain("`reference_assets` JSON NOT NULL");
    expect(migrationSql).toContain(
      "`capability_snapshot_version` JSON NOT NULL",
    );
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_preset_scene`(`scene_card_id`)",
    );
    // 可变：带 version/is_delete
    expect(migrationSql).toContain("`version` INTEGER NOT NULL DEFAULT 1");
    expect(baselineSql).toContain("CREATE TABLE `scene_card_generation_presets`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_preset_scene`(`scene_card_id`)",
    );
  });

  it("creates scene_card_generation_records with the four-state summary_status", () => {
    expect(migrationSql).toContain("CREATE TABLE `scene_card_generation_records`");
    expect(migrationSql).toContain("`summary_status` VARCHAR(16) NOT NULL");
    expect(migrationSql).toContain("`plan_message_id` BIGINT NOT NULL");
    expect(migrationSql).toContain("`application_receipt_id` BIGINT NOT NULL");
    expect(migrationSql).toContain("`first_generation_job_id` BIGINT NOT NULL");
    expect(baselineSql).toContain("CREATE TABLE `scene_card_generation_records`");
  });

  it("baseline 与 migration 三表 DDL 关键行一致（fresh-MySQL 不缺表）", () => {
    for (const table of [
      "plan_application_receipts",
      "scene_card_generation_presets",
      "scene_card_generation_records",
    ]) {
      expect(baselineSql).toContain(`CREATE TABLE \`${table}\``);
      expect(migrationSql).toContain(`CREATE TABLE \`${table}\``);
    }
  });
});
