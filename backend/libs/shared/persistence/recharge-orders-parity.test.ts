import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


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
    expect(migrationSql).toContain("UNIQUE INDEX `uk_recharge_orders__trade_no`(`trade_no`)");
    expect(migrationSql).toContain(
      "UNIQUE INDEX `uk_recharge_orders__pay_order_id`(`pay_order_id`)",
    );
  });

  it("积分在下单时刻冻结：credits 与 credits_per_yuan 都不可空", () => {
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
    expect(schemaPrisma).toContain("model billing_recharge_orders {");
    expect(schemaPrisma).toContain("model bw_platform_settings {");
    expect(schemaPrisma).toContain('map: "uk_billing_recharge_orders__trade_no"');
    expect(schemaPrisma).toContain('map: "uk_billing_recharge_orders__pay_order_id"');
  });
});
