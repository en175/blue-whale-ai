import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// recharge_orders 补两条列表索引（管理端「充值记录」页的两种口径）。
// 镜像 generation-jobs-gmt-create-index-parity 的三轨核对结构。

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

/** 取出指定索引的列清单（顺序敏感）。 */
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
    // 这两条服务的是同一页的两个口径（带 / 不带 user_id 筛选）：
    // 全站那条的第二列是 gmt_create，收窄不到某个用户头上；
    // 按用户那条必须把 user_id 排在 gmt_create 之前，否则等值条件退化成过滤。
    // 少一条 = 另一个口径继续全表扫。
    expect(standaloneSql).toContain(ALL_SITE_INDEX);
    expect(standaloneSql).toContain(PER_USER_INDEX);
  });

  it("★ 两条索引的列顺序：is_delete 恒在最前，排序列恒在最后", () => {
    // is_delete 是每条读路径上的等值条件（仓储层恒定 where.is_delete = 0），
    // 放最前做前缀；gmt_create 是排序列，必须在末尾 ——
    // 反过来放范围列在前，等值条件会退化成逐行过滤，而 EXPLAIN 仍显示"用上了索引"。
    expect(columnsOf(standaloneSql, ALL_SITE_INDEX)).toEqual(["is_delete", "gmt_create"]);
    expect(columnsOf(standaloneSql, PER_USER_INDEX)).toEqual([
      "is_delete",
      "user_id",
      "gmt_create",
    ]);
  });

  it("索引里不显式写 id：InnoDB 二级索引自带主键，MySQL 8.0 判顺序时算上它", () => {
    // 排序键是 (gmt_create DESC, id DESC)（DATETIME 只到秒，同秒并列靠 id 定序），
    // 但 id 不需要出现在索引定义里。哪天真把它写进来不会报错、也不会红 ——
    // 只是白白加宽索引，所以这里钉住。
    expect(columnsOf(standaloneSql, ALL_SITE_INDEX)).not.toContain("id");
    expect(columnsOf(standaloneSql, PER_USER_INDEX)).not.toContain("id");
  });

  it("status 刻意不建索引，且迁移里写明代价（不许看起来像全覆盖）", () => {
    // 低基数列（四值）+ 要覆盖就得再加两条索引；代价是带 status 筛选时
    // 只能在索引上逐条过滤。这段说明是给下一个改索引的人看的，不能只剩索引名。
    expect(standaloneSql).toContain("⚠️ status 筛选刻意不覆盖");
    expect(standaloneSql).toContain("代价说清楚");
    expect(standaloneSql).toContain("罕见值");
  });

  it("Prisma 模型与迁移同源（列同样的顺序）", () => {
    // Prisma 侧写成别的顺序不会报错、也不会红 ——
    // 下一次 `prisma migrate` 会把它当成一次**索引重建**，顺序悄悄变回去。
    expect(schemaPrisma).toContain(`@@index([is_delete, gmt_create], map: "${ALL_SITE_INDEX}")`);
    expect(schemaPrisma).toContain(
      `@@index([is_delete, user_id, gmt_create], map: "${PER_USER_INDEX}")`,
    );
  });

  it("索引名有表名做前缀（本仓新索引的命名约定）", () => {
    for (const name of [ALL_SITE_INDEX, PER_USER_INDEX]) {
      expect(name.startsWith("idx_recharge_orders__")).toBe(true);
      expect(standaloneSql).toContain("`" + name + "`");
    }
  });
});
