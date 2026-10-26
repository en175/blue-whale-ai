import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL("../../../prisma/migrations/20260928100000_bw_prefix_rename/migration.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/054_bw_prefix_rename.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260928_bw_prefix_rename.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(new URL("../../../prisma/schema.prisma", import.meta.url), "utf8");

const sqlOnly = migrationSql.replace(/^\s*--.*$/gm, "");
const normalizedSql = sqlOnly.replace(/\s+/g, " ");

const TABLE_RENAMES: Array<[string, string]> = [
  ["identity_users", "bw_users"],
  ["identity_verification_codes", "bw_verification_codes"],
  ["identity_memberships", "bw_memberships"],
  ["identity_roles", "bw_roles"],
  ["identity_user_roles", "bw_user_roles"],
  ["identity_login_logs", "bw_login_logs"],
];

const INDEX_RENAMES: Array<[string, string, string]> = [
  ["identity_users", "uk_identity_users__username", "uk_bw_users__username"],
  ["identity_users", "uk_identity_users__email", "uk_bw_users__email"],
  ["identity_memberships", "uk_identity_memberships__grant_key", "uk_bw_memberships__grant_key"],
  [
    "identity_memberships",
    "idx_identity_memberships__user_status_expiry",
    "idx_bw_memberships__user_status_expiry",
  ],
  ["identity_roles", "uk_identity_roles__code", "uk_bw_roles__code"],
  ["identity_user_roles", "uk_identity_user_roles__grant_key", "uk_bw_user_roles__grant_key"],
  ["identity_user_roles", "idx_identity_user_roles__user", "idx_bw_user_roles__user"],
  ["identity_login_logs", "idx_identity_login_logs__user_time", "idx_bw_login_logs__user_time"],
  ["identity_login_logs", "idx_identity_login_logs__ip_time", "idx_bw_login_logs__ip_time"],
];

const LEGACY_INDEXES = ["idx_phone", "idx_ip_created", "idx_phone_created", "idx_phone_unused"];

const BACKEND_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsFiles(full, acc);
    else if (entry.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

describe("identity_* → bw_* 三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("六张表全部改名", () => {
    for (const [from, to] of TABLE_RENAMES) {
      expect(normalizedSql).toContain(`\`${from}\` TO \`${to}\``);
    }
  });

  it("表改名是一条原子 RENAME TABLE，且目标恰好六张", () => {
    const occurrences = [...sqlOnly.matchAll(/RENAME TABLE/g)];
    expect(occurrences).toHaveLength(1);
    const start = occurrences[0].index ?? -1;
    const statement = sqlOnly.slice(start, sqlOnly.indexOf(";", start));
    expect(statement.match(/TO `bw_/g) ?? []).toHaveLength(TABLE_RENAMES.length);
  });

  it("九个索引名都改到位，且挂在**本次执行时**的表名上", () => {
    for (const [table, from, to] of INDEX_RENAMES) {
      expect(normalizedSql).toContain(`ALTER TABLE \`${table}\``);
      expect(normalizedSql).toContain(`RENAME INDEX \`${from}\` TO \`${to}\``);
    }
  });

  it("索引改名排在表改名之前（有失败风险的那一步放最前）", () => {
    const tableRename = sqlOnly.indexOf("RENAME TABLE");
    const firstIndexRename = sqlOnly.indexOf("RENAME INDEX");
    expect(firstIndexRename).toBeGreaterThan(-1);
    expect(tableRename).toBeGreaterThan(firstIndexRename);
  });

  it("索引改名正好九条，且不碰 baseline 带进来的名字", () => {
    expect(sqlOnly.match(/RENAME INDEX/g) ?? []).toHaveLength(INDEX_RENAMES.length);
    for (const keep of LEGACY_INDEXES) {
      expect(normalizedSql).not.toContain(`RENAME INDEX \`${keep}\``);
    }
  });

  it("Prisma 模型名与 map 名都跟着迁移走", () => {
    for (const [from, to] of TABLE_RENAMES) {
      expect(schemaPrisma).toContain(`model ${to} {`);
      expect(schemaPrisma).not.toContain(`model ${from} {`);
    }
    for (const [, from, to] of INDEX_RENAMES) {
      expect(schemaPrisma).toContain(`map: "${to}"`);
      expect(schemaPrisma).not.toContain(`map: "${from}"`);
    }
    expect(schemaPrisma).not.toContain("@@map");
  });

  it("backend 全量 TS 里没有 prisma.identity_* 的漏改 call site", () => {
    const offenders = collectTsFiles(BACKEND_ROOT)
      .filter((f) => /prisma\.identity_[a-z_]+/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(BACKEND_ROOT.length));

    expect(offenders).toEqual([]);
  });
});
