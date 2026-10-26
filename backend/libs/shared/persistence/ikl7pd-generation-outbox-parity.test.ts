import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const MIGRATION_SQL = readFileSync(
  new URL(
    "../../../prisma/migrations/20261013060000_ikl7pd_generation_outbox/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const SNAPSHOT_SQL = readFileSync(
  new URL("../../../prisma/schema/064_ikl7pd_generation_outbox.sql", import.meta.url),
  "utf8",
);

const STANDALONE_SQL = readFileSync(
  new URL("../../../../docs/sql/20261013_ikl7pd_generation_outbox.sql", import.meta.url),
  "utf8",
);

const SQL_CODE = MIGRATION_SQL.replace(/^\s*--.*$/gm, "");

describe("generation_outbox 三轨一致（IKL7PD）", () => {
  it("三份 SQL 逐字相同", () => {
    expect(SNAPSHOT_SQL).toBe(MIGRATION_SQL);
    expect(STANDALONE_SQL).toBe(MIGRATION_SQL);
  });

  it("首行钉字符集", () => {
    expect(MIGRATION_SQL.split("\n")[0]).toBe("SET NAMES utf8mb4;");
  });

  it("只建这一张表，且不动任何已有对象", () => {
    expect(SQL_CODE.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(SQL_CODE).toContain("CREATE TABLE `generation_outbox`");
    expect(SQL_CODE).not.toMatch(/\bALTER\b/i);
    expect(SQL_CODE).not.toMatch(/\bDROP\b/i);
    expect(SQL_CODE).not.toMatch(/\bUPDATE\b/i);
    expect(SQL_CODE).not.toMatch(/\bINSERT\b/i);
  });

  it("列齐备：终态事件本身 + 投递状态与重试计数", () => {
    for (const column of [
      "job_id",
      "user_id",
      "terminal_status",
      "reason",
      "send_state",
      "attempts",
      "gmt_create",
      "gmt_modified",
      "sent_at",
    ]) {
      expect(SQL_CODE).toContain(`\`${column}\``);
    }
  });

  it("投递扫描走 (send_state, id)，且带 job 回查索引", () => {
    expect(SQL_CODE).toContain("INDEX `idx_generation_outbox__pending`(`send_state`, `id`)");
    expect(SQL_CODE).toContain("INDEX `idx_generation_outbox__job`(`job_id`)");
    expect(SQL_CODE).toContain("PRIMARY KEY (`id`)");
  });

  it("pending 是默认态，表只装终态事件（没有 topic 列）", () => {
    expect(SQL_CODE).toContain("`send_state`      VARCHAR(16)  NOT NULL DEFAULT 'pending'");
    expect(SQL_CODE).not.toContain("`topic`");
  });
});
