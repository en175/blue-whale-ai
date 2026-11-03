import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261103160000_iksllc_reference_image_limits/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/092_iksllc_reference_image_limits.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261103_iksllc_reference_image_limits.sql", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

describe("参考图上限按模型配置（IKSLLC）：三轨迁移", () => {
  it("三轨逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且是纯数据迁移", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
  });

  it("Seedance 全部视频行配 36M 像素与 2.5 比例", () => {
    expect(standaloneSql).toContain("`capability_type` = 'video'");
    expect(standaloneSql).toContain("`model_id` LIKE 'doubao-seedance-%'");
    expect(standaloneSql).toContain("'$.max_reference_image_pixels', 36000000");
    expect(standaloneSql).toContain("'$.max_reference_image_ratio', 2.5");
  });

  it("seed-audio-1.0 配 10 MB 图片上限", () => {
    expect(standaloneSql).toContain("`capability_type` = 'audio'");
    expect(standaloneSql).toContain("`model_id` = 'seed-audio-1.0'");
    expect(standaloneSql).toContain("'$.max_reference_image_bytes', 10485760");
  });

  it("两条 UPDATE 都带 is_delete 过滤且只改 features", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(2);
    expect(sqlCode.match(/`is_delete` = 0/g) ?? []).toHaveLength(2);
    expect(sqlCode).not.toMatch(/SET\s+`(?!features`)/);
  });

  it("002_seed 同步带上同一批配置", () => {
    expect(seedSql).toContain("'max_reference_image_pixels', 36000000");
    expect(seedSql).toContain("'max_reference_image_ratio', 2.5");
    expect(seedSql).toContain("'max_reference_image_bytes', 10485760");
  });
});
