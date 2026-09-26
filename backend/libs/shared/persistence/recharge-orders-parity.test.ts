import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 充值接回支付通道：`recharge_orders`（本地订单）+ `system_settings`（商户凭证）。
// 镜像 identity-memberships-parity 的三轨核对结构：prisma migration、schema 独立文件、
// docs/sql 快照三处同源。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925140000_recharge_orders_and_settings/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/035_recharge_orders_and_settings.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_recharge_orders_and_settings.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

describe("recharge_orders / system_settings 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("幂等两条路径都落在唯一索引上，不靠应用层判重", () => {
    // trade_no：我们生成的商户订单号，重投时靠它认出同一笔
    expect(migrationSql).toContain("UNIQUE INDEX `uk_recharge_orders__trade_no`(`trade_no`)");
    // pay_order_id：网关订单号，防止同一笔网关订单挂到两条本地订单（= 多发一次积分）
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_recharge_orders__pay_order_id`(`pay_order_id`)",
    );
  });

  it("积分在下单时刻冻结：credits 与 credits_per_yuan 都不可空", () => {
    // 若 credits 允许为空，到账时就得「按当前换算率现算」——改口径会影响已付款用户
    expect(migrationSql).toMatch(/`credits`\s+BIGINT\s+NOT NULL/);
    expect(migrationSql).toMatch(/`credits_per_yuan`\s+INT\s+NOT NULL/);
  });

  it("pay_order_id 可空 —— 下单应答回来之前还没有它", () => {
    expect(migrationSql).toMatch(/`pay_order_id`\s+VARCHAR\(64\)\s+NULL/);
  });

  it("凭证行带 is_secret 标记（密文与明文在库里可区分）", () => {
    expect(migrationSql).toMatch(/`is_secret`\s+TINYINT\s+NOT NULL DEFAULT 0/);
  });

  it("Prisma 模型与建表语句同源（表名与幂等唯一索引对齐）", () => {
    // Prisma 认不出索引的 map 名时会想再改一次 schema，数据库就在两套描述之间漂移
    expect(schemaPrisma).toContain("model recharge_orders {");
    expect(schemaPrisma).toContain("model system_settings {");
    expect(schemaPrisma).toContain('map: "uk_recharge_orders__trade_no"');
    expect(schemaPrisma).toContain('map: "uk_recharge_orders__pay_order_id"');
  });
});
