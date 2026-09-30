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
// IKJCOE：这批列随后被 20260930150000 收敛进 generation_job_extras 并从主表 DROP。
const extrasMigrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260930150000_generation_job_extras/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

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

  it("七列已从 model generation_jobs 迁走（IKJCOE）：六列搬进 generation_job_extras，source_sample_job_id 留主表", () => {
    const start = schemaPrisma.indexOf("model generation_jobs {");
    const end = schemaPrisma.indexOf("@@index([project_id]", start);
    const model = schemaPrisma.slice(start, end);
    // 搬进扩展位的六列 + 它们的 value_type（extra_key 沿用原列名，故这里的键名逐字可查）。
    const MOVED: Record<string, string> = {
      video_stage: "string",
      final_job_id: "number",
      upstream_created_at_ms: "number",
      finalize_deadline_ms: "number",
      charge_state: "string",
      actual_credits: "number",
    };
    for (const column of COLUMNS) {
      if (column === "source_sample_job_id") {
        // 它扛来源唯一索引，不能搬——必须仍在主表上。
        expect(model, "source_sample_job_id 须留在主表（扛唯一索引）").toContain(`${column} `);
        continue;
      }
      expect(model, `schema.prisma 仍残留已收敛掉的主表列 ${column}`).not.toContain(`${column} `);
      // 回填段逐键搬家：值落在扩展表，类型随列而定。
      expect(
        extrasMigrationSql,
        `回填段缺 ${column}（或 value_type 与列不符）`,
      ).toContain(`\`id\`, '${column}', '${MOVED[column]}'`);
      // 先回填后删列的顺序不可换（否则数据直接丢）。
      expect(extrasMigrationSql, `DROP COLUMN ${column} 缺失`).toContain(`DROP COLUMN \`${column}\``);
    }
    expect(extrasMigrationSql).toContain("INSERT IGNORE INTO `generation_job_extras`");
    expect(extrasMigrationSql).toContain(
      "UNIQUE INDEX `uk_generation_job_extras__job_key`(`generation_job_id`, `extra_key`)",
    );
  });
});
