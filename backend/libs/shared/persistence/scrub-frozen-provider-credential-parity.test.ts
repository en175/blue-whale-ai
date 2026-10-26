import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261008120000_scrub_frozen_provider_credential/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/061_scrub_frozen_provider_credential.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261008_scrub_frozen_provider_credential.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

function modelBlock(name: string): string {
  const start = schemaPrisma.indexOf(`model ${name} {`);
  expect(start, `schema.prisma 缺少 model ${name}`).toBeGreaterThanOrEqual(0);
  const end = schemaPrisma.indexOf("}", start);
  return schemaPrisma.slice(start, end);
}

describe("清扫冻结上游凭证：三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 是纯数据迁移：没有任何 DDL", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
    expect(sqlCode).not.toMatch(/TRUNCATE/i);
  });

  it("★ 只点删那一个键：用 JSON_REMOVE，不整列重写", () => {
    expect(sqlCode).toContain("JSON_REMOVE(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_REPLACE(");
  });

  it("★ 幂等守卫：每条 UPDATE 都由 JSON_CONTAINS_PATH 短路", () => {
    const updates = sqlCode.match(/UPDATE\s+`[a-z_]+`/g) ?? [];
    const guards = sqlCode.match(/JSON_CONTAINS_PATH\(/g) ?? [];
    expect(updates).toHaveLength(2);
    expect(guards).toHaveLength(2);
  });

  it("★ 落点一：generation_jobs.input 顶层键 $.provider_credential，且排在最先", () => {
    const firstUpdate = sqlCode.indexOf("UPDATE");
    const jobsUpdate = sqlCode.indexOf("UPDATE `generation_jobs`");
    const logsUpdate = sqlCode.indexOf("UPDATE `generation_job_logs`");
    expect(jobsUpdate).toBe(firstUpdate);
    expect(jobsUpdate).toBeLessThan(logsUpdate);
    expect(sqlCode).toContain("JSON_REMOVE(`input`, '$.provider_credential')");
    expect(sqlCode).toContain("JSON_CONTAINS_PATH(`input`, 'one', '$.provider_credential')");
  });

  it("★ 落点二：generation_job_logs.payload 嵌套键 $.input.provider_credential（两层）", () => {
    expect(sqlCode).toContain("JSON_REMOVE(`payload`, '$.input.provider_credential')");
    expect(sqlCode).toContain(
      "JSON_CONTAINS_PATH(`payload`, 'one', '$.input.provider_credential')",
    );
  });

  it("★ 表名/列名与本仓 schema.prisma 对得上（表名别猜）", () => {
    const jobs = modelBlock("generation_jobs");
    expect(jobs).toContain("input");
    expect(jobs).toContain("Json?");
    expect(jobs).not.toContain("@@map");

    const logs = modelBlock("generation_job_logs");
    expect(logs).toContain("payload");
    expect(logs).toContain("Json?");
    expect(logs).not.toContain("@@map");
  });

  it("★ 不碰任何别的键（只出现两次 JSON_REMOVE，路径只此两条）", () => {
    const removes = sqlCode.match(/JSON_REMOVE\(/g) ?? [];
    expect(removes).toHaveLength(2);
    const paths = sqlCode.match(/'(\$[^']*)'/g) ?? [];
    expect(new Set(paths)).toEqual(new Set(["'$.provider_credential'", "'$.input.provider_credential'"]));
  });

  it("★ 历史 VARCHAR 落点已消失：本迁移不出现 user_info", () => {
    expect(sqlCode).not.toContain("user_info");
  });
});
