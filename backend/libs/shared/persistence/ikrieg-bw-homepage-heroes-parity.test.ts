import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029170000_ikrieg_bw_homepage_heroes/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/087_ikrieg_bw_homepage_heroes.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrieg_bw_homepage_heroes.sql", import.meta.url),
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

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

const statementsOf = (sql: string) =>
  sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));

describe("首页运营表归位 bw_ 前缀（IKRIEG）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("只做一条表改名语句", () => {
    for (const sql of TRACKS) {
      expect(statementsOf(sql)).toEqual([
        "SET NAMES utf8mb4;",
        "RENAME TABLE `content_homepage_heroes` TO `bw_homepage_heroes`;",
      ]);
    }
  });

  it("不改不含旧表名的索引", () => {
    for (const sql of TRACKS) {
      expect(sql).not.toContain("RENAME INDEX");
      expect(sql).not.toContain("idx_hero_enabled_sort");
      expect(sql).not.toContain("idx_hero_sort");
      expect(sql).not.toContain("idx_hero_scene_enabled_sort");
    }
  });

  it("Prisma 模型与 Java 测试 schema 同步新表名", () => {
    expect(schemaPrisma).toContain("model bw_homepage_heroes {");
    expect(schemaPrisma).not.toContain("model content_homepage_heroes {");
    expect(schemaPrisma).toContain('"idx_hero_enabled_sort"');
    expect(schemaPrisma).toContain('"idx_hero_sort"');
    expect(schemaPrisma).toContain('"idx_hero_scene_enabled_sort"');
    expect(javaSchemaSql).toContain("CREATE TABLE `bw_homepage_heroes`");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `content_homepage_heroes`");
  });
});
