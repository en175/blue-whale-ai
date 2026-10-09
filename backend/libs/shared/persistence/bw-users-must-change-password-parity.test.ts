import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260930120000_bw_users_must_change_password/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/058_bw_users_must_change_password.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260930_bw_users_must_change_password.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("bw_users.must_change_password 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 默认值必须是 0 —— 存量用户不该被集体拦去改密", () => {
    expect(migrationSql).toMatch(/`must_change_password`[^,;]*NOT NULL DEFAULT 0/i);
  });

  it("列定义精确：NOT NULL，不是「有/没有/未知」三态", () => {
    expect(migrationSql).toMatch(
      /ADD COLUMN `must_change_password` TINYINT\(1\) NOT NULL DEFAULT 0/,
    );
  });

  it("prisma 模型里有这一列且默认 false（模型与 SQL 不能各说各话）", () => {
    expect(schemaPrisma).toMatch(
      /must_change_password\s+Boolean\s+@default\(false\)/,
    );
  });
});
