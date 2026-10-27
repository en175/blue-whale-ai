import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261027230000_ikqy3o_billing_identity_ops_rename/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/079_ikqy3o_billing_identity_ops_rename.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261027_ikqy3o_billing_identity_ops_rename.sql", import.meta.url),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);
const javaSchemaSql = readFileSync(
  new URL(
    "../../../../server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql",
    import.meta.url,
  ),
  "utf8",
);
const cleanupScript = readFileSync(
  new URL("../../../scripts/cleanup-project-card-migration-history.mjs", import.meta.url),
  "utf8",
);

const RENAMED = new Map([
  ["topup_tiers", "billing_products"],
  ["recharge_orders", "billing_recharge_orders"],
  ["cost_reservations", "billing_cost_reservations"],
  ["cost_adjustments", "billing_cost_adjustments"],
  ["admin_operation_logs", "bw_admin_logs"],
  ["system_settings", "bw_platform_settings"],
  ["command_idempotency", "project_command_receipts"],
  ["legacy_card_history", "project_card_migration_history"],
]);

const INDEX_RENAMES = new Map([
  ["uk_recharge_orders__trade_no", "uk_billing_recharge_orders__trade_no"],
  ["uk_recharge_orders__pay_order_id", "uk_billing_recharge_orders__pay_order_id"],
  ["idx_recharge_orders__is_delete_gmt_create", "idx_billing_recharge_orders__is_delete_gmt_create"],
  [
    "idx_recharge_orders__is_delete_user_gmt_create",
    "idx_billing_recharge_orders__is_delete_user_gmt_create",
  ],
  ["uk_cost_reservation_job", "uk_billing_cost_reservations__job"],
  ["uk_command_idempotency", "uk_project_command_receipts__key"],
  ["uk_legacy_card_history", "uk_project_card_migration_history__node"],
]);

const JAVA_SCHEMA_RENAMED = [...RENAMED].filter(
  ([from]) => from !== "recharge_orders" && from !== "system_settings",
);

const BACKEND_ROOT = new URL("../../..", import.meta.url).pathname;
const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;

function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "gen" || entry.name === "node_modules") continue;
      productionSources(path, acc);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".mjs")) &&
      !entry.name.includes(".test.")
    ) {
      acc.push(path);
    }
  }
  return acc;
}

function javaSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      javaSources(path, acc);
    } else if (entry.name.endsWith(".java")) {
      acc.push(path);
    }
  }
  return acc;
}

describe("IKQY3O 三轨迁移（计费 / 身份 / 运维 / 命令回执表改名）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("8 张表按一条多表 RENAME TABLE 原子改名", () => {
    const renames = [...migrationSql.matchAll(/RENAME TABLE ([^;]+);/g)];
    expect(renames).toHaveLength(1);
    const statement = renames[0][1];
    for (const [from, to] of RENAMED) {
      expect(statement).toContain("`" + from + "` TO `" + to + "`");
    }
    expect(statement.match(/ TO /g)).toHaveLength(RENAMED.size);
  });

  it("索引改名先于表改名", () => {
    for (const [from, to] of INDEX_RENAMES) {
      expect(migrationSql).toContain("RENAME INDEX `" + from + "` TO `" + to + "`");
    }
    expect(migrationSql.indexOf("RENAME TABLE")).toBeGreaterThan(
      migrationSql.lastIndexOf("RENAME INDEX"),
    );
  });

  it("迁移历史表写入保留期表注释", () => {
    expect(migrationSql).toContain("ALTER TABLE `project_card_migration_history` COMMENT");
    expect(migrationSql).toContain("180 天");
  });

  it("清理脚本按保留期删除超期行", () => {
    expect(cleanupScript).toContain("project_card_migration_history");
    expect(cleanupScript).toContain("RETENTION_DAYS");
    expect(cleanupScript).toContain("DELETE FROM project_card_migration_history");
  });

  it("Prisma 模型只剩新表名", () => {
    for (const [from, to] of RENAMED) {
      expect(schemaPrisma).toContain("model " + to + " {");
      expect(schemaPrisma).not.toContain("model " + from + " {");
    }
    for (const [from, to] of INDEX_RENAMES) {
      expect(schemaPrisma).not.toContain('"' + from + '"');
      expect(schemaPrisma).toContain('"' + to + '"');
    }
  });

  it("Java 测试 schema 同步新表名", () => {
    for (const [from, to] of JAVA_SCHEMA_RENAMED) {
      expect(javaSchemaSql).not.toContain("CREATE TABLE `" + from + "`");
      expect(javaSchemaSql).toContain("CREATE TABLE `" + to + "`");
    }
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).toContain("CREATE TABLE `command_idempotency`");
    expect(baselineSql).not.toContain("CREATE TABLE `project_command_receipts`");
  });

  it("生产代码与运维脚本不再访问旧表名", () => {
    const names =
      "topup_tiers|recharge_orders|cost_reservations|cost_adjustments|admin_operation_logs|system_settings|command_idempotency|legacy_card_history";
    const accessor = new RegExp("\\b(prisma|tx|client)\\.(" + names + ")\\b");
    const rawSql = new RegExp("\\b(FROM|INTO|JOIN|UPDATE)\\s+`?(" + names + ")`?\\b", "i");
    const files = [
      ...productionSources(join(BACKEND_ROOT, "libs")),
      ...productionSources(join(BACKEND_ROOT, "apps")),
      ...productionSources(join(BACKEND_ROOT, "scripts")),
      ...productionSources(join(REPO_ROOT, "scripts")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (accessor.test(text) || rawSql.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("Java 生产代码不再引用旧表名", () => {
    const names =
      "topup_tiers|recharge_orders|cost_reservations|cost_adjustments|admin_operation_logs|system_settings|command_idempotency|legacy_card_history";
    const reference = new RegExp("\\b(" + names + ")\\b");
    const files = javaSources(join(REPO_ROOT, "server/blue-whale-worker/src/main"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      if (reference.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
