import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKIZQ8：generation_jobs 两阶段视频阶段列（video_stage / 来源互指 / 可信 created_at /
// 截止 / 阶段费用）三轨迁移核对——镜像 generation-jobs-gmt-create-index-parity 的结构。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929120000_generation_jobs_video_sample_stage/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/055_generation_jobs_video_sample_stage.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_generation_jobs_video_sample_stage.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

/** 本迁移落下的七个列名（与 ADD COLUMN 顺序一致）。 */
const COLUMNS = [
  "video_stage",
  "source_sample_job_id",
  "final_job_id",
  "upstream_created_at_ms",
  "finalize_deadline_ms",
  "charge_state",
  "actual_credits",
] as const;

describe("generation_jobs 样片阶段列三轨迁移（IKIZQ8）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("七个列全部可空、无默认值（存量行保持 NULL = 旧任务按普通视频处理）", () => {
    for (const column of COLUMNS) {
      const m = migrationSql.match(new RegExp(`ADD COLUMN \`${column}\`[^\\n]*`));
      expect(m, `列 ${column} 缺失`).not.toBeNull();
      expect(m![0], `列 ${column} 须可空`).toContain("NULL");
      expect(m![0], `列 ${column} 不给默认值`).not.toContain("DEFAULT");
    }
  });

  it("★ 不建 source_sample_job_id 唯一约束（成片票才落地 FINALIZE_SOURCE_UNIQUE_KEY）", () => {
    // 注释里出现「唯一约束」字样是说明，不是 DDL——只拦真正的约束语句。
    expect(migrationSql).not.toMatch(/ADD UNIQUE|UNIQUE KEY|UNIQUE INDEX|CREATE UNIQUE/);
  });

  it("Prisma 模型与迁移同源（七列都在 model generation_jobs 上）", () => {
    const start = schemaPrisma.indexOf("model generation_jobs {");
    const end = schemaPrisma.indexOf("@@index([project_id]", start);
    const model = schemaPrisma.slice(start, end);
    for (const column of COLUMNS) {
      expect(model, `schema.prisma 缺列 ${column}`).toContain(`${column} `);
    }
  });
});
