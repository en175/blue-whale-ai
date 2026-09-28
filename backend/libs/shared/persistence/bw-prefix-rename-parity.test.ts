import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 表名与索引名前缀收敛：identity_* → bw_*（六张表 + 其上的九个索引）。
// 镜像 identity-users-parity 的三轨核对结构。

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

/** 去掉 `--` 注释后的纯 SQL。断言要查语句，不能查散文——注释里提到 RENAME 是解释，不是执行。 */
const sqlOnly = migrationSql.replace(/^\s*--.*$/gm, "");
/** 迁移里为对齐打过多余空格，故再归一化空白后匹配。 */
const normalizedSql = sqlOnly.replace(/\s+/g, " ");

/** 表改名：旧表名 → 新表名。 */
const TABLE_RENAMES: Array<[string, string]> = [
  ["identity_users", "bw_users"],
  ["identity_verification_codes", "bw_verification_codes"],
  ["identity_memberships", "bw_memberships"],
  ["identity_roles", "bw_roles"],
  ["identity_user_roles", "bw_user_roles"],
  ["identity_login_logs", "bw_login_logs"],
];

/** 索引改名：[旧表名, 旧索引名, 新索引名]。索引改在表改名**之前**，故此处是旧表名。 */
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

/** 从 baseline 带进来的索引名，不含 identity_ 前缀，**不在**本次收敛范围。 */
const LEGACY_INDEXES = ["idx_phone", "idx_ip_created", "idx_phone_created", "idx_phone_unused"];

const BACKEND_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** 递归收集 backend/ 下所有 .ts，用来证明没有 call site 漏改。 */
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
    // 拆成多条会停在「前几张改了、后几张没改」，而 RENAME 不可重入、重跑直接失败。
    const occurrences = [...sqlOnly.matchAll(/RENAME TABLE/g)];
    expect(occurrences).toHaveLength(1);
    // 只钉 from→to 对是不够的：往同一条语句里再塞一对，上面每条 toContain 都还是绿的。
    const start = occurrences[0].index ?? -1;
    const statement = sqlOnly.slice(start, sqlOnly.indexOf(";", start));
    expect(statement.match(/TO `bw_/g) ?? []).toHaveLength(TABLE_RENAMES.length);
  });

  it("九个索引名都改到位，且挂在**本次执行时**的表名上", () => {
    // 索引改名排在表改名之前，所以这几条 ALTER 用的是旧表名——RENAME INDEX 的目标名
    // 只是字符串，不要求与表名一致。
    for (const [table, from, to] of INDEX_RENAMES) {
      expect(normalizedSql).toContain(`ALTER TABLE \`${table}\``);
      expect(normalizedSql).toContain(`RENAME INDEX \`${from}\` TO \`${to}\``);
    }
  });

  it("索引改名排在表改名之前（有失败风险的那一步放最前）", () => {
    // 反过来的话，任何一条 RENAME INDEX 失败都会停在「表已改名、索引没跟上」：
    // 旧代码当场读不到表，而 RENAME TABLE 不可重入、重跑第一步就报「表不存在」。
    // 现在的顺序半途失败时表仍是原名，线上代码照常跑。
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
      // 反向：旧 model 名还留着的话，migrate 会当成两张不同的表。
      expect(schemaPrisma).not.toContain(`model ${from} {`);
    }
    for (const [, from, to] of INDEX_RENAMES) {
      expect(schemaPrisma).toContain(`map: "${to}"`);
      // 只改 map 名而库里不动（或反过来）都会让 `migrate` 反复改 schema。
      expect(schemaPrisma).not.toContain(`map: "${from}"`);
    }
    // 整个改名策略建立在「模型名 == 表名」上（本仓零 @@map）。若给 model bw_users 补一句
    // @@map("identity_users")，上面所有断言仍然全绿，而 Prisma 会指回一张不存在的表。
    expect(schemaPrisma).not.toContain("@@map");
  });

  it("backend 全量 TS 里没有 prisma.identity_* 的漏改 call site", () => {
    // 表改了名而代码没跟上，是最典型的「编译过、运行时炸」。
    const offenders = collectTsFiles(BACKEND_ROOT)
      .filter((f) => /prisma\.identity_[a-z_]+/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(BACKEND_ROOT.length));

    expect(offenders).toEqual([]);
  });
});
