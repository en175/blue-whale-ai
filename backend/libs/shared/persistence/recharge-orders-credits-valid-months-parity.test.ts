import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260927070000_recharge_order_credits_valid_months/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/053_recharge_order_credits_valid_months.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20260927_recharge_order_credits_valid_months.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("recharge_orders 有效期月数快照 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("列可空 —— 本列上线前的存量单没有这个快照", () => {
    expect(migrationSql).toMatch(/`credits_valid_months`\s+INT\s+NULL/);
  });

  it("**不给默认值**：默认值会让存量行凭空多出一个从未承诺过的有效期", () => {
    const columns = migrationSql.slice(migrationSql.indexOf("ALTER TABLE"));
    expect(columns).not.toMatch(/`credits_valid_months`[^,;]*DEFAULT/i);
  });

  it("prisma schema 与迁移同步（漏改一处，客户端就写不进这一列）", () => {
    expect(schemaPrisma).toMatch(/credits_valid_months\s+Int\?/);
  });

  it("列注释写清「为什么是月数」：起算点是支付成功时刻，下单那刻算不出来", () => {
    expect(migrationSql).toContain("paid_pending_at");
    expect(migrationSql).toContain("支付成功");
  });
});
