import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const dropMigration = read(
  "../../../prisma/migrations/20261022120000_bw_users_drop_must_change_password/migration.sql",
);
const dropStandalone = read("../../../prisma/schema/074_bw_users_drop_must_change_password.sql");
const dropSnapshot = read("../../../../docs/sql/20261022_bw_users_drop_must_change_password.sql");

const schemaPrisma = read("../../../prisma/schema.prisma");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "../../../..");
const SELF = fileURLToPath(import.meta.url);

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "gen"].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("bw_users.must_change_password 删除 — 074 drop", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(dropStandalone).toBe(dropMigration);
    expect(dropSnapshot).toBe(dropMigration);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(dropMigration).toContain("SET NAMES utf8mb4");
  });

  it("可执行正文只有 SET NAMES + 一条 DROP COLUMN", () => {
    const statements = statementsOf(dropMigration);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("SET NAMES utf8mb4");
    expect(statements[1]).toBe(
      "ALTER TABLE `bw_users` DROP COLUMN `must_change_password`",
    );
  });

  it("Prisma 模型已删除该字段", () => {
    expect(schemaPrisma).not.toMatch(/\bmust_change_password\b/);
  });

  it("★ backend / web/src 源码里不再引用该标记", () => {
    const roots = [join(REPO_ROOT, "backend"), join(REPO_ROOT, "web/src")];
    const offenders = roots
      .flatMap((root) => collectSourceFiles(root))
      .filter((file) => file !== SELF)
      .filter((file) => /must_change_password|mustChangePassword/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file))
      .sort();

    expect(offenders).toEqual([]);
  });
});
