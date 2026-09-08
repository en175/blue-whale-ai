import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260904120000_ikdbyy_channel_parser/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/015_ikdbyy_channel_parser.sql", import.meta.url),
  "utf8",
);

describe("IKDBYY incremental migration", () => {
  it("adds channel_parser and request_mapping", () => {
    expect(migrationSql).toContain("`channel_parser` VARCHAR(32) NOT NULL DEFAULT 'seedream'");
    expect(migrationSql).toContain("`request_mapping` JSON NULL");
    expect(migrationSql).toContain("INSERT IGNORE INTO generation_model_capability");
    expect(migrationSql).toContain("'gpt-image-2-light'");
  });

  it("baseline 必须同步：fresh-MySQL 只加载 baseline", () => {
    expect(baselineSql).toContain("`channel_parser` VARCHAR(32) NOT NULL DEFAULT 'seedream'");
    expect(baselineSql).toContain("`request_mapping` JSON NULL");
  });

  it("standalone schema/015 与 migration 的 DDL 一致", () => {
    expect(standaloneSql).toContain("`channel_parser` VARCHAR(32) NOT NULL DEFAULT 'seedream'");
    expect(standaloneSql).toContain("`request_mapping` JSON NULL");
    expect(standaloneSql).toContain("INSERT IGNORE INTO generation_model_capability");
    expect(standaloneSql).toContain("'gpt-image-2'");
    expect(standaloneSql).toContain("'nano-banana'");
  });
});
