import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029150000_ikrgon_project_entry_kind/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/086_ikrgon_project_entry_kind.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrgon_project_entry_kind.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("IKRGON 三轨迁移（project entry_kind）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
    expect(migrationSql).toBe(snapshotSql);
  });

  it("新增 entry_kind 列，默认 canvas", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain(
        "ADD COLUMN `entry_kind` VARCHAR(16) NOT NULL DEFAULT 'canvas'",
      );
    }
  });

  it("schema 基线片段含 SET NAMES utf8mb4", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("schema.prisma project model 同步该列", () => {
    expect(schemaPrisma).toMatch(
      /^\s*entry_kind\s+String\s+@default\("canvas"\) @db\.VarChar\(16\)$/m,
    );
  });
});
