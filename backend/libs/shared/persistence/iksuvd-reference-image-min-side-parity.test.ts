import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261104150000_iksuvd_reference_image_min_side/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/093_iksuvd_reference_image_min_side.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261104_iksuvd_reference_image_min_side.sql", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

describe("参考图单边下限（IKSUVD）：三轨迁移", () => {
  it("三轨逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且是纯数据迁移", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
  });

  it("只给 Seedance 视频行配 300", () => {
    expect(sqlCode.match(/UPDATE\s+`catalog_models`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`capability_type` = 'video'");
    expect(standaloneSql).toContain("`model_id` LIKE 'doubao-seedance-%'");
    expect(standaloneSql).toContain("'$.min_reference_image_side', 300");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });

  it("002_seed 同步带上同一配置", () => {
    expect(seedSql).toContain("'min_reference_image_side', 300");
  });
});
