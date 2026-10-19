import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261019120000_ikosu1_seedance_edit_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/066_ikosu1_seedance_edit_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261019_ikosu1_seedance_edit_pricing.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

describe("IKOSU1 Seedance 2.5 编辑价目迁移：三轨", () => {
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
  });

  it("★ 只更新 2.5 一行，带 is_delete 过滤并递增 version", () => {
    expect(sqlCode.match(/UPDATE `generation_model_capability`/g) ?? []).toHaveLength(1);
    expect(sqlCode).toContain("`model_id` = 'doubao-seedance-2-5-260628'");
    expect(sqlCode).toContain("`capability_type` = 'video'");
    expect(sqlCode).toContain("`is_delete` = 0");
    expect(sqlCode).toContain("JSON_TYPE(`pricing`) = 'OBJECT'");
    expect(sqlCode).toContain("`version` = `version` + 1");
  });

  it("★ 编辑加项：videoEdit 150000、referenceSeconds 10000，删除 multipliers", () => {
    expect(sqlCode).toContain("JSON_MERGE_PATCH(");
    expect(sqlCode).not.toContain("JSON_REPLACE(");
    expect(sqlCode).toContain(
      "'dims', JSON_OBJECT('usage.referenceSeconds', 10000, 'usage.videoEdit', 150000)",
    );
    expect(sqlCode).toContain("'multipliers', NULL");
    expect(sqlCode).not.toContain("'usage.videoEdit', 20000");
  });

  it("★ basePrice 表不动（只改 dims 与 multipliers）", () => {
    expect(sqlCode).not.toContain("'basePrice'");
    expect(sqlCode).not.toContain("resolution=480p");
    expect(sqlCode).not.toContain("resolution=720p");
    expect(sqlCode).not.toContain("resolution=1080p");
  });
});
