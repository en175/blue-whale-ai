import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029130000_ikre7x_template_card_is_featured/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/077_ikre7x_template_card_is_featured.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikre7x_template_card_is_featured.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("IKRE7X 三轨迁移（template_card is_featured）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
    expect(migrationSql).toBe(snapshotSql);
  });

  it("新增 is_featured 列，默认 0", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain(
        "ADD COLUMN `is_featured` TINYINT NOT NULL DEFAULT 0",
      );
    }
  });

  it("schema 基线片段含 SET NAMES utf8mb4", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("schema.prisma template_card model 同步该列", () => {
    expect(schemaPrisma).toMatch(/^\s*is_featured\s+Int\s+@default\(0\) @db\.TinyInt$/m);
  });
});
