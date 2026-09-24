import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 自建用户体系第一刀：会员周期表（identity_memberships）。
// 镜像 ikhexg/ikg4ur-parity 的三轨核对结构：prisma migration、schema 独立文件、docs/sql 快照三处同源。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260924120000_identity_memberships/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/030_identity_memberships.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260924_identity_memberships.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("identity_memberships 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("幂等键落在唯一索引上，不靠应用层判重", () => {
    expect(migrationSql).toContain("UNIQUE INDEX `uk_identity_memberships__grant_key`");
  });

  it("等级推导的查询条件有对应索引", () => {
    // 条件 (user_id, status, expires_at) 与索引列序一致；顺序反了就用不上。
    expect(migrationSql).toContain(
      "`idx_identity_memberships__user_status_expiry`(`user_id`, `status`, `expires_at`)",
    );
  });

  it("expires_at 可空 —— NULL 表示永久，建表时就不能写成 NOT NULL", () => {
    expect(migrationSql).toMatch(/`expires_at`\s+DATETIME\(0\)\s+NULL/);
  });

  it("Prisma 模型与建表语句同源（表名、唯一索引、普通索引三处对齐）", () => {
    // Prisma 认不出唯一/普通索引的 map 名时，`prisma migrate dev` 会想再改一次 schema——
    // 那意味着数据库在两套描述之间来回漂移。这里把三处名字钉死。
    expect(schemaPrisma).toContain("model identity_memberships {");
    expect(schemaPrisma).toContain('map: "uk_identity_memberships__grant_key"');
    expect(schemaPrisma).toContain('map: "idx_identity_memberships__user_status_expiry"');
  });
});
