import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// identity_users.email 加唯一索引。镜像 identity-users-parity 的三轨核对结构。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925120000_identity_users_email_unique/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/034_identity_users_email_unique.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_identity_users_email_unique.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");
const userRepo = readFileSync(new URL("./identity-user-repo.ts", import.meta.url), "utf8");

describe("identity_users.email 唯一索引三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 空串清成 NULL 排在建索引之前", () => {
    // MySQL 唯一索引对 NULL 互不相等，对空串**不是**：留着一行 email = ''，
    // 建索引时会以一条看不懂的 Duplicate entry '' 失败。
    const cleanEmpty = migrationSql.indexOf("SET `email` = NULL");
    const addIndex = migrationSql.indexOf("ADD UNIQUE INDEX `uk_identity_users__email`");

    expect(cleanEmpty).toBeGreaterThan(-1);
    expect(addIndex).toBeGreaterThan(-1);
    expect(cleanEmpty).toBeLessThan(addIndex);
  });

  it("只清空串，不清 NULL（幂等，重跑不会改动别的行）", () => {
    expect(migrationSql).toMatch(/WHERE `email` = ''/);
  });

  it("Prisma 模型与迁移同源", () => {
    // Prisma 侧漏了 @unique 会让下一次 migrate 试图把索引 DROP 掉
    expect(schemaPrisma).toMatch(/email\s+String\?\s+@unique\(map: "uk_bw_users__email"\)/);
  });

  it("★ 登录查询必须覆盖 username 与 email 两条路径", () => {
    // 索引是为「邮箱登录不歧义」建的。若查询只按 username 查，索引就白建了；
    // 若查询按 email 查而索引缺失，就是上面那条越权。
    expect(userRepo).toContain("OR: [{ username: loginName }, { email: loginName }]");
  });

  it("★ 建号靠唯一索引判重，不做「先 SELECT 再 INSERT」", () => {
    // 先查后插在并发下会两个都通过检查、一个插入失败；
    // P2002 是数据库给出的精确答案，没有竞态。
    expect(userRepo).toContain("isUniqueViolation");
    expect(userRepo).toContain("UsernameTakenError");
  });
});
