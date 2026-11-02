import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029120000_ikre7u_project_last_edited/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/076_ikre7u_project_last_edited.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikre7u_project_last_edited.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("IKRE7U 三轨迁移（project last_edited_at）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
    expect(migrationSql).toBe(snapshotSql);
  });

  it("新增 last_edited_at 列并以创建时间回填", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain(
        "ADD COLUMN `last_edited_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP",
      );
      expect(sql).toContain("UPDATE `project` SET `last_edited_at` = `gmt_create`;");
    }
  });

  it("schema 基线片段含 SET NAMES utf8mb4", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("schema.prisma project model 同步该列", () => {
    expect(schemaPrisma).toMatch(/^\s*last_edited_at\s+DateTime\s+@default\(now\(\)\) @db\.DateTime\(0\)$/m);
  });
});
