import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 充值订单加两列：`cashier_url`（复用未支付单）与 `paid_pending_at`（主动对账的时钟起点）。
// 镜像 recharge-orders-record-index-parity 的三轨核对结构：prisma migration、schema 独立文件、
// docs/sql 快照三处同源。

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
    // cashier_url：本列上线前的单、以及下单时网关调用就失败的单都没有链接
    expect(migrationSql).toMatch(/`cashier_url`\s+VARCHAR\(512\)\s+NULL/);
    // paid_pending_at：本列上线前进入 paid_pending 的存量单没有这个时刻
    expect(migrationSql).toMatch(/`paid_pending_at`\s+DATETIME\(0\)\s+NULL/);
  });

  it("两列都不带 DEFAULT —— 空值的含义是「没有」，不是「某个时刻」", () => {
    // 若给 paid_pending_at 加 `DEFAULT CURRENT_TIMESTAMP`，存量行与新建行的空值就都变成
    // 「此刻」，主动对账会把「从没进入过待到账」的行当成刚落地的单，永远扫不到异常单
    const columns = migrationSql.slice(migrationSql.indexOf("ALTER TABLE"));
    expect(columns).not.toMatch(/`cashier_url`[^,]*DEFAULT/i);
    expect(columns).not.toMatch(/`paid_pending_at`[^,;]*DEFAULT/i);
  });

  it("prisma schema 与迁移同步（漏改一处，客户端就写不进这一列）", () => {
    expect(schemaPrisma).toMatch(/cashier_url\s+String\?\s+@db\.VarChar\(512\)/);
    expect(schemaPrisma).toMatch(/paid_pending_at\s+DateTime\?\s+@db\.DateTime\(0\)/);
  });

  it("注释里写清了「不复用会怎样」与「为什么不能用 gmt_modified 顶替」", () => {
    // 这两列都是**因为一个具体缺陷**才加的。注释没了，下一个人只会看到两个「顺手加的列」，
    // 然后拿 gmt_modified 去替 paid_pending_at（回调一到达，持有分钟数就归零）
    expect(migrationSql).toContain("Uni_MchNo_MchOrderNo");
    expect(migrationSql).toContain("gmt_modified");
  });
});
