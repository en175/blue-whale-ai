import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261030120000_skill_domain_two_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/090_skill_domain_two_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261030_skill_domain_two_tables.sql", import.meta.url),
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

describe("技能域两表改造迁移（090）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("声明 SET NAMES utf8mb4", () => {
    expect(migrationSql).toContain("SET NAMES utf8mb4");
  });

  it("先扩列换索引，再回填与补行，最后删两张旧表", () => {
    const alter = migrationSql.indexOf("ALTER TABLE `catalog_skills`");
    const backfill = migrationSql.indexOf("UPDATE `catalog_skills` s");
    const insert = migrationSql.indexOf("INSERT INTO `catalog_skills`");
    const count = migrationSql.indexOf("skills_without_content");
    const dropVersions = migrationSql.indexOf("DROP TABLE IF EXISTS `catalog_creative_skill_versions`");
    const dropSkills = migrationSql.indexOf("DROP TABLE IF EXISTS `catalog_creative_skills`");
    expect(alter).toBeGreaterThanOrEqual(0);
    expect(alter).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(insert);
    expect(insert).toBeLessThan(count);
    expect(count).toBeLessThan(dropVersions);
    expect(dropVersions).toBeLessThan(dropSkills);
  });

  it("新增三列、按 owner 唯一、移除全局同名约束", () => {
    for (const column of ["creative_skill_id", "owner_user_id", "name_key"]) {
      expect(migrationSql).toContain("`" + column + "`");
    }
    expect(migrationSql).toContain("uk_catalog_skills__owner_name");
    expect(migrationSql).toContain("uk_catalog_skills__creative_skill_id");
    expect(migrationSql).toContain("DROP INDEX `uk_name`");
  });

  it("Prisma 只保留 catalog_skills 与 user_skills", () => {
    expect(schemaPrisma).toContain("model catalog_skills {");
    expect(schemaPrisma).toContain("model user_skills {");
    expect(schemaPrisma).not.toContain("model catalog_creative_skills {");
    expect(schemaPrisma).not.toContain("model catalog_creative_skill_versions {");
    expect(schemaPrisma).toContain('"uk_catalog_skills__owner_name"');
  });

  it("Java 测试 schema 同步三列，不再建两张旧表", () => {
    expect(javaSchemaSql).not.toContain("CREATE TABLE `catalog_creative_skills`");
    expect(javaSchemaSql).not.toContain("CREATE TABLE `catalog_creative_skill_versions`");
    expect(javaSchemaSql).toContain("`creative_skill_id` VARCHAR(80) NULL");
    expect(javaSchemaSql).toContain("`owner_user_id` BIGINT NOT NULL DEFAULT 0");
    expect(javaSchemaSql).toContain("`name_key` VARCHAR(255) NULL");
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
