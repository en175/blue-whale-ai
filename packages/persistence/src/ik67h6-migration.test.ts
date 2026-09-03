import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../prisma/migrations/20260805120000_ik67h6_plan_message/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67H6 incremental migration", () => {
  it("adds content_type to conversation_messages for the plan_message subtype", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `conversation_messages` ADD COLUMN `content_type` VARCHAR(24) NOT NULL DEFAULT 'text'",
    );
    // baseline 必须同步：fresh-MySQL 只加载 baseline，缺列会让黑盒拓扑全线红。
    expect(baselineSql).toContain(
      "`content_type` VARCHAR(24) NOT NULL DEFAULT 'text'",
    );
  });

  // IKCKOW：run_commits 表已随旧 Agent 引擎删除，baseline 不再含该表。
  // 历史 migration 文件保留原样（ALTER run_commits 仅作用于升级链上的旧形态）。

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
    // baseline 双写
    expect(baselineSql).toContain("CREATE TABLE `plan_messages`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_plan_message_message`(`message_id`)",
    );
  });
});
