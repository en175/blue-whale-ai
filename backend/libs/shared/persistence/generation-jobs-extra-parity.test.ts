import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260930150000_generation_job_extras/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/059_generation_job_extras.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260930_generation_job_extras.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("generation_job_extras 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("幂等键落在唯一索引上，列序 (job_id, extra_key)，不靠应用层判重", () => {
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_generation_job_extras__job_key`(`generation_job_id`, `extra_key`)",
    );
  });

  it("不建 generation_job_id 单列索引 —— 唯一索引最左前缀已覆盖", () => {
    expect(migrationSql).not.toContain("idx_generation_job_extras__generation_job_id");
  });

  it("回填段逐列一条（搬走的 8 列，非 NULL 才回填）", () => {
    const backfills = migrationSql.match(/INSERT IGNORE INTO `generation_job_extras`/g) ?? [];
    expect(backfills).toHaveLength(8);
    for (const key of [
      "strategy_version",
      "canvas_card_state",
      "video_stage",
      "final_job_id",
      "upstream_created_at_ms",
      "finalize_deadline_ms",
      "charge_state",
      "actual_credits",
    ]) {
      expect(migrationSql).toContain(`SELECT \`id\`, '${key}',`);
      expect(migrationSql).toContain(`DROP COLUMN \`${key}\``);
    }
  });

  it("canvas_card_state 只回填 <> 'pending' 的行（缺键即缺省 pending）", () => {
    expect(migrationSql).toContain("WHERE `canvas_card_state` <> 'pending'");
  });

  it("删掉 7 个不再需要的列 + 那条只为 next_poll_at 而活的索引", () => {
    for (const col of [
      "next_poll_at",
      "stage_id",
      "evidence_reconcile_until",
      "agent_run_id",
      "action_identity",
      "project_action_identity",
      "expected_output_count",
    ]) {
      expect(migrationSql).toContain(`DROP COLUMN \`${col}\``);
    }
    expect(migrationSql).toContain("DROP INDEX `idx_status_next_poll`");
  });

  it("Prisma 模型与建表语句同源（表名、唯一索引两处对齐）", () => {
    expect(schemaPrisma).toContain("model generation_job_extras {");
    expect(schemaPrisma).toContain('map: "uk_generation_job_extras__job_key"');
    expect(schemaPrisma).not.toContain('map: "idx_status_next_poll"');
  });
});
