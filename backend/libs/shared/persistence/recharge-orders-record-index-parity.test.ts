import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260925180000_recharge_orders_record_index/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/037_recharge_orders_record_index.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260925_recharge_orders_record_index.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const ALL_SITE_INDEX = "idx_recharge_orders__is_delete_gmt_create";
const PER_USER_INDEX = "idx_recharge_orders__is_delete_user_gmt_create";

function columnsOf(sql: string, indexName: string): string[] {
  const m = sql.match(new RegExp("ADD INDEX\\s+`" + indexName + "`\\s*\\(([^)]*)\\)"));
  expect(m).not.toBeNull();
  return m![1].split(",").map((c) => c.trim().replace(/`/g, ""));
}

describe("recharge_orders 记录页列表索引三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 一条迁移里出两条索引：全站一条、按用户一条", () => {
    expect(standaloneSql).toContain(ALL_SITE_INDEX);
    expect(standaloneSql).toContain(PER_USER_INDEX);
  });

  it("★ 两条索引的列顺序：is_delete 恒在最前，排序列恒在最后", () => {
    expect(columnsOf(standaloneSql, ALL_SITE_INDEX)).toEqual(["is_delete", "gmt_create"]);
    expect(columnsOf(standaloneSql, PER_USER_INDEX)).toEqual([
      "is_delete",
      "user_id",
      "gmt_create",
    ]);
  });

  it("索引里不显式写 id：InnoDB 二级索引自带主键，MySQL 8.0 判顺序时算上它", () => {
    expect(columnsOf(standaloneSql, ALL_SITE_INDEX)).not.toContain("id");
    expect(columnsOf(standaloneSql, PER_USER_INDEX)).not.toContain("id");
  });

  it("status 刻意不建索引，且迁移里写明代价（不许看起来像全覆盖）", () => {
    expect(standaloneSql).toContain("⚠️ status 筛选刻意不覆盖");
    expect(standaloneSql).toContain("代价说清楚");
    expect(standaloneSql).toContain("罕见值");
  });

  it("Prisma 模型与迁移同源（列同样的顺序）", () => {
    expect(schemaPrisma).toContain(
      `@@index([is_delete, gmt_create], map: "idx_billing_recharge_orders__is_delete_gmt_create")`,
    );
    expect(schemaPrisma).toContain(
      `@@index([is_delete, user_id, gmt_create], map: "idx_billing_recharge_orders__is_delete_user_gmt_create")`,
    );
  });

  it("索引名有表名做前缀（本仓新索引的命名约定）", () => {
    for (const name of [ALL_SITE_INDEX, PER_USER_INDEX]) {
      expect(name.startsWith("idx_recharge_orders__")).toBe(true);
      expect(standaloneSql).toContain("`" + name + "`");
    }
  });
});
