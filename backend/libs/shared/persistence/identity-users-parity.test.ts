import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 自建用户体系：账号主体改造（users → identity_users，username 唯一、phone 可空）。
// 镜像 identity_memberships-parity 的三轨核对结构。

const migrationSql = readFileSync(
  new URL("../../../prisma/migrations/20260924180000_identity_users/migration.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/031_identity_users.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260924_identity_users.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const authRepo = readFileSync(new URL("./auth-repo.ts", import.meta.url), "utf8");

describe("identity_users 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("有失败风险的那一步（加唯一索引）排在改名之前", () => {
    // MySQL 的 DDL 不是事务性的：若先改名再发现用户名重复，会停在
    // 「表已改名、索引没加上」的半途，而 RENAME 不可重入、重跑会失败。
    const addIndex = migrationSql.indexOf("ADD UNIQUE INDEX `uk_identity_users__username`");
    const rename = migrationSql.indexOf("RENAME TABLE `users` TO `identity_users`");

    expect(addIndex).toBeGreaterThan(-1);
    expect(rename).toBeGreaterThan(-1);
    expect(addIndex).toBeLessThan(rename);
  });

  it("回填空用户名排在唯一索引之前（空串会互撞）", () => {
    const backfill = migrationSql.indexOf("CONCAT('user_', `id`)");
    const addIndex = migrationSql.indexOf("ADD UNIQUE INDEX `uk_identity_users__username`");

    expect(backfill).toBeGreaterThan(-1);
    expect(backfill).toBeLessThan(addIndex);
  });

  it("phone 改为可空", () => {
    expect(migrationSql).toMatch(/MODIFY COLUMN `phone` VARCHAR\(20\) NULL/);
  });

  it("两张表都改到 identity_ 前缀", () => {
    expect(migrationSql).toContain("`users` TO `identity_users`");
    expect(migrationSql).toContain("`verification_codes` TO `identity_verification_codes`");
  });

  it("Prisma 模型与迁移同源", () => {
    expect(schemaPrisma).toContain("model identity_users {");
    expect(schemaPrisma).toContain("model identity_verification_codes {");
    expect(schemaPrisma).toContain('map: "uk_identity_users__username"');
    // phone 可空：Prisma 侧漏了 `?` 会让下一次 migrate 试图把列改回 NOT NULL
    expect(schemaPrisma).toMatch(/phone\s+String\?\s+@unique\(map: "idx_phone"\)/);
  });

  it("TS 侧不再引用旧表名", () => {
    // 表改了名而代码没跟上，是最典型的「编译过、运行时炸」。
    expect(authRepo).toContain("prisma.identity_users");
    expect(authRepo).toContain("prisma.identity_verification_codes");
    expect(authRepo).not.toMatch(/prisma\.users\b/);
    expect(authRepo).not.toMatch(/prisma\.verification_codes\b/);
  });
});
