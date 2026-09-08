import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260806090000_ik67hf_storyboard_preview/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IK67HF incremental migration", () => {
  it("creates storyboard_previews with the per-command unique + scene/project indexes", () => {
    expect(migrationSql).toContain("CREATE TABLE `storyboard_previews`");
    expect(migrationSql).toContain("`scene_card_id` BIGINT NOT NULL");
    expect(migrationSql).toContain("`first_generation_job_id` BIGINT NOT NULL");
    expect(migrationSql).toContain("`command_id` VARCHAR(128) NOT NULL");
    expect(migrationSql).toContain("`summary_status` VARCHAR(16) NOT NULL");
    expect(migrationSql).toContain(
      "`capability_snapshot_version` JSON NOT NULL",
    );
    // command_id 幂等（operation=scene_card.storyboard_preview）
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_storyboard_command`(`project_id`, `command_id`)",
    );
    expect(migrationSql).toContain("INDEX `idx_storyboard_scene`(`scene_card_id`)");
    expect(migrationSql).toContain("INDEX `idx_storyboard_project`(`project_id`)");
    // 可变附属表：带 version/is_delete
    expect(migrationSql).toContain("`version` INTEGER NOT NULL DEFAULT 1");
    expect(migrationSql).toContain("`is_delete` TINYINT NOT NULL DEFAULT 0");
  });

  it("baseline 双写 storyboard_previews（fresh-MySQL 不缺表）", () => {
    expect(baselineSql).toContain("CREATE TABLE `storyboard_previews`");
    expect(baselineSql).toContain(
      "UNIQUE INDEX `uk_storyboard_command`(`project_id`, `command_id`)",
    );
    expect(baselineSql).toContain("INDEX `idx_storyboard_scene`(`scene_card_id`)");
  });

  it("baseline 与 migration DDL 关键行一致（fresh-MySQL 不缺表）", () => {
    expect(baselineSql).toContain("CREATE TABLE `storyboard_previews`");
    expect(migrationSql).toContain("CREATE TABLE `storyboard_previews`");
  });
});
