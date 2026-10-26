import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925160000_generation_jobs_gmt_create_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/036_generation_jobs_gmt_create_index.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_generation_jobs_gmt_create_index.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const INDEX_NAME = "idx_generation_jobs__is_delete_gmt_create";

describe("generation_jobs 区间统计索引三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 列顺序是 (is_delete, gmt_create)，不是反过来", () => {
    const m = standaloneSql.match(/ADD INDEX\s+`[^`]+`\s*\(([^)]*)\)/);
    expect(m).not.toBeNull();
    const cols = m![1].split(",").map((c) => c.trim().replace(/`/g, ""));
    expect(cols).toEqual(["is_delete", "gmt_create"]);
  });

  it("Prisma 模型与迁移同源（列同样的顺序）", () => {
    expect(schemaPrisma).toContain(`@@index([is_delete, gmt_create], map: "${INDEX_NAME}")`);
  });

  it("索引名有表名做前缀（本仓新索引的命名约定）", () => {
    expect(standaloneSql).toContain(INDEX_NAME);
  });
});
