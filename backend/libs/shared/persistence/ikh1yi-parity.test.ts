import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKH1YI：project 表 last_opened_at / pinned_at 两列（记住上次打开 + 置顶）。
// 镜像 ikfyhj-parity 的双轨核对结构：schema 基线片段、prisma migration、docs/sql 快照三处同源。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260919190000_ikh1yi_project_last_opened_pinned/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/028_ikh1yi_project_last_opened_pinned.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260919_ikh1yi_project_last_opened_pinned.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("IKH1YI 双轨迁移（project last_opened_at / pinned_at）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(migrationSql).toBe(standaloneSql);
    expect(migrationSql).toBe(snapshotSql);
  });

  it("三处都加 last_opened_at 与 pinned_at 两列（DATETIME(0) NULL）", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain("ALTER TABLE `project` ADD COLUMN `last_opened_at` DATETIME(0) NULL;");
      expect(sql).toContain("ALTER TABLE `project` ADD COLUMN `pinned_at` DATETIME(0) NULL;");
    }
  });

  it("schema 基线片段含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("schema.prisma project model 同步两列（可空 DateTime(0)）", () => {
    expect(schemaPrisma).toContain("last_opened_at DateTime? @db.DateTime(0)");
    expect(schemaPrisma).toMatch(/^\s*pinned_at\s+DateTime\? @db\.DateTime\(0\)$/m);
    // 两列不带 @updatedAt：写入只动目标列，不牵连 gmt_modified/version（IKH1YI 验收项）
    expect(schemaPrisma).not.toMatch(/(last_opened_at|pinned_at)[^\n]*@updatedAt/);
  });
});
