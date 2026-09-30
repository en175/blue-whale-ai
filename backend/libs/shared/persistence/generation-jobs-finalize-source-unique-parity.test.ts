import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKIZQC：generation_jobs 成片来源唯一约束（FINALIZE_SOURCE_UNIQUE_KEY）三轨迁移核对
// ——镜像 generation-jobs-video-sample-stage-parity 的结构。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929130000_generation_jobs_finalize_source_unique/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/056_generation_jobs_finalize_source_unique.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_generation_jobs_finalize_source_unique.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

describe("generation_jobs 成片来源唯一约束三轨迁移（IKIZQC）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 唯一约束只落 source_sample_job_id 单列（裸索引，不带 is_delete 复合）", () => {
    expect(migrationSql).toMatch(
      /ADD UNIQUE KEY `uk_generation_jobs__source_sample_job_id` \(`source_sample_job_id`\)/,
    );
    // G08：失败尝试也占位——索引出现在何处分句不影响语义，但复合键会让「软删绕过占位」成为可能。
    expect(migrationSql).not.toMatch(/UNIQUE KEY[^\n]*is_delete/);
  });

  it("Prisma 模型与迁移同源（@@unique 落在 model generation_jobs 上，映射同名）", () => {
    const start = schemaPrisma.indexOf("model generation_jobs {");
    const end = schemaPrisma.indexOf("@@index([is_delete, gmt_create]", start);
    const model = schemaPrisma.slice(start, end);
    expect(model).toContain(
      '@@unique([source_sample_job_id], map: "uk_generation_jobs__source_sample_job_id")',
    );
  });
});
