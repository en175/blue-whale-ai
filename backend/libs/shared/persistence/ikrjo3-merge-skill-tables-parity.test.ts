import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029200000_ikrjo3_merge_skill_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/090_ikrjo3_merge_skill_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrjo3_merge_skill_tables.sql", import.meta.url),
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

const BACKEND_ROOT = new URL("../../..", import.meta.url).pathname;

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

describe("IKRJO3 技能域四表收敛为两张", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(migrationSql).toContain("SET NAMES utf8mb4");
  });

  it("先扩列与回填，再删正文列与两张旧表", () => {
    const addColumns = migrationSql.indexOf("ALTER TABLE `catalog_skills`");
    const backfill = migrationSql.indexOf("UPDATE `catalog_skills` s");
    const insertRemaining = migrationSql.indexOf("INSERT INTO `catalog_skills`");
    const dropContent = migrationSql.indexOf("DROP COLUMN `content`");
    const dropVersions = migrationSql.indexOf("DROP TABLE IF EXISTS `catalog_creative_skill_versions`");
    const dropSkills = migrationSql.indexOf("DROP TABLE IF EXISTS `catalog_creative_skills`");
    expect(addColumns).toBeGreaterThanOrEqual(0);
    expect(addColumns).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(insertRemaining);
    expect(insertRemaining).toBeLessThan(dropContent);
    expect(dropContent).toBeLessThan(dropVersions);
    expect(dropVersions).toBeLessThan(dropSkills);
  });

  it("个人技能名不再受全局唯一约束，改为 owner+name_key 索引", () => {
    expect(migrationSql).toContain("DROP INDEX `uk_name`");
    expect(migrationSql).toContain("idx_catalog_skills__owner_name_key");
    expect(migrationSql).toContain("uk_catalog_skills__creative_skill_id");
  });

  it("Prisma 模型只剩技能本体与引用两张表", () => {
    expect(schemaPrisma).toContain("model catalog_skills {");
    expect(schemaPrisma).toContain("model user_skills {");
    expect(schemaPrisma).not.toContain("model catalog_creative_skills {");
    expect(schemaPrisma).not.toContain("model catalog_creative_skill_versions {");
    expect(schemaPrisma).toContain("creative_skill_id");
    expect(schemaPrisma).toContain("content_digest");
    expect(schemaPrisma).toContain('"idx_catalog_skills__owner_name_key"');
  });

  it("Java 测试 schema 同步：技能本体含正文与归属列，不再建两张旧表", () => {
    expect(javaSchemaSql).not.toContain("CREATE TABLE `catalog_creative_skills`");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `catalog_creative_skill_versions`");
    expect(javaSchemaSql).toContain("`creative_skill_id` VARCHAR(80) NULL");
    expect(javaSchemaSql).toContain("`owner_user_id` BIGINT NOT NULL DEFAULT 0");
    expect(javaSchemaSql).toContain("`body` LONGTEXT NULL");
  });

  it("后端生产代码不再访问两张旧表", () => {
    const names = "catalog_creative_skills|catalog_creative_skill_versions";
    const accessor = new RegExp("\\b(prisma|tx|client)\\.(" + names + ")\\b");
    const rawSql = new RegExp("\\b(FROM|INTO|JOIN|UPDATE)\\s+`?(" + names + ")`?\\b", "i");
    const files = [
      ...productionSources(join(BACKEND_ROOT, "libs")),
      ...productionSources(join(BACKEND_ROOT, "apps")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (accessor.test(text) || rawSql.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
