import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260927050000_recharge_order_cashier_and_paid_pending_at/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/051_recharge_order_cashier_and_paid_pending_at.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260927_recharge_order_cashier_and_paid_pending_at.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("recharge_orders 收银台链接 / 待到账时刻 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("两列都可空 —— 存量单没有它们，而它们为空不该让订单行不可读", () => {
    expect(migrationSql).toMatch(/`cashier_url`\s+VARCHAR\(512\)\s+NULL/);
    expect(migrationSql).toMatch(/`paid_pending_at`\s+DATETIME\(0\)\s+NULL/);
  });

  it("两列都不带 DEFAULT —— 空值的含义是「没有」，不是「某个时刻」", () => {
    const columns = migrationSql.slice(migrationSql.indexOf("ALTER TABLE"));
    expect(columns).not.toMatch(/`cashier_url`[^,]*DEFAULT/i);
    expect(columns).not.toMatch(/`paid_pending_at`[^,;]*DEFAULT/i);
  });

  it("prisma schema 与迁移同步（漏改一处，客户端就写不进这一列）", () => {
    expect(schemaPrisma).toMatch(/cashier_url\s+String\?\s+@db\.VarChar\(512\)/);
    expect(schemaPrisma).toMatch(/paid_pending_at\s+DateTime\?\s+@db\.DateTime\(0\)/);
  });

  it("注释里写清了「不复用会怎样」与「为什么不能用 gmt_modified 顶替」", () => {
    expect(migrationSql).toContain("Uni_MchNo_MchOrderNo");
    expect(migrationSql).toContain("gmt_modified");
  });
});
