import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL("../../../prisma/migrations/20260924200000_identity_roles/migration.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/032_identity_roles.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260924_identity_roles.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

describe("identity_roles 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("三张表都建了", () => {
    expect(migrationSql).toContain("CREATE TABLE `identity_roles`");
    expect(migrationSql).toContain("CREATE TABLE `identity_user_roles`");
    expect(migrationSql).toContain("CREATE TABLE `identity_login_logs`");
  });

  it("内置角色被播种——没有角色行，「谁是管理员」在断链那天直接无解", () => {
    for (const code of ["'user'", "'admin'", "'super_admin'"]) {
      expect(migrationSql).toContain(code);
    }
    expect(migrationSql).toContain("INSERT INTO `identity_roles`");
  });

  it("seed 的角色 code 与 core 侧的判定集合一致", () => {
    expect(migrationSql).toContain("('admin',");
    expect(migrationSql).toContain("('super_admin',");
  });

  it("登录日志的 user_id 可空（失败登录可能没有用户）", () => {
    expect(migrationSql).toMatch(/`user_id`\s+BIGINT\s+NULL/);
  });

  it("授权幂等键落在唯一索引上", () => {
    expect(migrationSql).toContain("UNIQUE INDEX `uk_identity_user_roles__grant_key`");
  });

  it("Prisma 模型与迁移同源", () => {
    for (const model of ["bw_roles", "bw_user_roles", "bw_login_logs"]) {
      expect(schemaPrisma).toContain(`model ${model} {`);
    }
    expect(schemaPrisma).toContain('map: "uk_bw_roles__code"');
    expect(schemaPrisma).toContain('map: "uk_bw_user_roles__grant_key"');
    expect(schemaPrisma).toMatch(/^  user_id\s+BigInt\?$/m);
  });

  it("本迁移不动守卫里的魔数（读侧切换是独立一步）", () => {
    expect(migrationSql).toContain("ADMIN_ROLE_THRESHOLD");
  });
});
