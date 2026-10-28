import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261028170000_ikq1hl_operation_logs/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/081_ikq1hl_operation_logs.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261028_ikq1hl_operation_logs.sql", import.meta.url),
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
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);

describe("IKQ1HL 三轨迁移（操作日志表收敛）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("表从 bw_admin_logs 改名为 bw_operation_logs", () => {
    expect(migrationSql).toContain(
      "RENAME TABLE `bw_admin_logs` TO `bw_operation_logs`",
    );
  });

  it("新增 status、ref 两列与查询索引", () => {
    expect(migrationSql).toContain("ADD COLUMN `status` TINYINT NOT NULL DEFAULT 0");
    expect(migrationSql).toContain("ADD COLUMN `ref` VARCHAR(64) NULL");
    expect(migrationSql).toContain("ADD INDEX `idx_bw_operation_logs__ref` (`ref`)");
  });

  it("Prisma 模型只剩新表名并包含新列", () => {
    expect(schemaPrisma).toContain("model bw_operation_logs {");
    expect(schemaPrisma).not.toContain("model bw_admin_logs {");
    expect(schemaPrisma).toContain("status         Int      @default(0) @db.TinyInt");
    expect(schemaPrisma).toContain("ref            String?  @db.VarChar(64)");
  });

  it("Java 测试 schema 同步新表名与新列", () => {
    expect(javaSchemaSql).not.toContain("CREATE TABLE `bw_admin_logs`");
    expect(javaSchemaSql).toContain("CREATE TABLE `bw_operation_logs`");
    expect(javaSchemaSql).toContain("`status` TINYINT NOT NULL DEFAULT 0");
    expect(javaSchemaSql).toContain("`ref` VARCHAR(64) NULL");
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).toContain("CREATE TABLE `admin_operation_logs`");
    expect(baselineSql).not.toContain("CREATE TABLE `bw_operation_logs`");
  });
});
