import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 退役 `recharge_orders.grant_lot_id`（billing 批次表在本地的一份副本）。
// 镜像 recharge-orders-credits-valid-months-parity 的三轨核对结构：
// prisma migration、schema 独立文件、docs/sql 快照三处同源。

const read = (fileUrlPath: string) =>
  readFileSync(new URL(fileUrlPath, import.meta.url), "utf8");

const migrationSql = read(
  "../../../prisma/migrations/20260929010000_recharge_order_drop_grant_lot_id/migration.sql",
);
const standaloneSql = read("../../../prisma/schema/056_recharge_order_drop_grant_lot_id.sql");
const snapshotSql = read("../../../../docs/sql/20260929_recharge_order_drop_grant_lot_id.sql");
const schemaPrisma = read("../../../prisma/schema.prisma");

/**
 * 剥掉 `--` 行注释后的**可执行正文**。
 *
 * <p>不能直接在全文里按分号数语句：本文件的注释里带着示例 SQL（`SELECT … ;`），
 * 那些分号不是语句分隔符。
 */
const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .trim();

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");
const SELF = fileURLToPath(import.meta.url);

/** 递归收集 `.ts` / `.tsx`（跳过 node_modules / dist / .git / 生成物）。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "gen"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("recharge_orders 退役 grant_lot_id 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("删的确实是这一列", () => {
    expect(migrationSql).toMatch(
      /ALTER TABLE\s+`recharge_orders`\s+DROP COLUMN\s+`grant_lot_id`/,
    );
  });

  it("★ 可执行正文只有 SET NAMES + 一条 DDL：DROP COLUMN 失败不可重入", () => {
    // 守的是「以后别往这个文件里追加**或前置**第二条语句」。
    // 逐条比形状而不是只数总数 —— 只切 ALTER 之后那段的话，**前置**插入的语句
    // 是看不见的，而「把有失败风险的一步放最前」这条规矩恰好会产生前置。
    const statements = executableSql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SET NAMES utf8mb4");
    expect(statements[1]).toMatch(
      /^ALTER TABLE\s+`recharge_orders`\s+DROP COLUMN\s+`grant_lot_id`$/,
    );
  });

  it("注释给的反查键是**有索引**的 grant_key，且说明了 biz_id 为什么不行", () => {
    expect(migrationSql).toContain("grant_key");
    expect(migrationSql).toContain("uk_lots__grant_key");
    // biz_id 没索引，且本金与首购赠送共用它（会一起查出来）—— 这两条坑必须写在注释里
    expect(migrationSql).toContain("biz_id");
    expect(migrationSql).toMatch(/没有索引|全表扫/);
    expect(migrationSql).toMatch(/赠送/);
  });

  it("注释交代了上线顺序：新库 + 旧镜像会挂掉读路径", () => {
    expect(migrationSql).toContain("旧镜像");
    expect(migrationSql).toContain("migrate deploy");
  });

  it("prisma schema 同步删掉字段（漏改一处，客户端类型就与库对不上）", () => {
    expect(schemaPrisma).not.toMatch(/\bgrant_lot_id\b/);
  });

  it("★ 全仓源码里不再有任何引用 —— 删之前核过「无读方」，删之后要保证没有残留", () => {
    // 硬编码一份文件清单不够：base 上有 6 个非 SQL 文件引过它，漏掉任何一个，
    // 「已退役」就只是句口号。所以扫 backend 源码树与 web/src。
    //
    // ⚠️ 规则是**绝对**的：**连注释里提一句都算**。这条列名如今只该出现在两处 ——
    //    迁移三轨（056）与本测试自己。想在别处引用它，就改写成指向迁移编号；
    //    名字一旦回流，下一个人就会以为它还在。
    // 跳过本文件自身 —— 它的正则与注释里就写着这个名字，会命中自己。
    const roots = [join(REPO_ROOT, "backend"), join(REPO_ROOT, "web/src")];
    const offenders = roots
      .flatMap((root) => collectSourceFiles(root))
      .filter((file) => file !== SELF)
      .filter((file) => /\bgrant_lot_id\b|\bgrantLotId\b/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file))
      .sort();

    expect(offenders).toEqual([]);
  });
});
