import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929100000_retire_plan_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/057_retire_plan_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_retire_plan_tables.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

describe("计划通道退役（plan_messages / plan_application_receipts）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("注释语法合法：`--` 后必须跟空格（MySQL 注释规则）", () => {
    for (const sql of TRACKS) {
      const bad = sql
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .filter((entry) => /^--[^ \-\n]/.test(entry.replace(/^\d+: /, "")));
      expect(bad).toEqual([]);
    }
  });

  it("两列都放宽为 NULL-able（放宽是必需的：写入方已删，新行无值可填）", () => {
    for (const sql of TRACKS) {
      expect(sql).toContain("MODIFY COLUMN `plan_message_id` BIGINT NULL");
      expect(sql).toContain(
        "MODIFY COLUMN `application_receipt_id` BIGINT NULL",
      );
    }
  });

  it("本迁移不删表（DROP 待零行核对后另落）", () => {
    for (const sql of TRACKS) expect(sql).not.toContain("DROP TABLE");
  });

  it("schema.prisma 不再有这两个 model", () => {
    expect(schemaPrisma).not.toContain("model plan_messages");
    expect(schemaPrisma).not.toContain("model plan_application_receipts");
  });

  it("承接放宽的 scene_card_generation_records 已随场景卡退役删除（IKRDNK）", () => {
    expect(schemaPrisma).not.toContain("model scene_card_generation_records");
  });
});
