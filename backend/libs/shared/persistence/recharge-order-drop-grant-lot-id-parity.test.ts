import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


const read = (fileUrlPath: string) =>
  readFileSync(new URL(fileUrlPath, import.meta.url), "utf8");

const migrationSql = read(
  "../../../prisma/migrations/20260929010000_recharge_order_drop_grant_lot_id/migration.sql",
);
const standaloneSql = read("../../../prisma/schema/056_recharge_order_drop_grant_lot_id.sql");
const snapshotSql = read("../../../../docs/sql/20260929_recharge_order_drop_grant_lot_id.sql");
const schemaPrisma = read("../../../prisma/schema.prisma");

const executableSql = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .trim();

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");
const SELF = fileURLToPath(import.meta.url);

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
