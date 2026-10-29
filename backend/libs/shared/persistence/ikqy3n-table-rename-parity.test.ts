import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261027220000_ikqy3n_catalog_prefix_rename/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/078_ikqy3n_catalog_prefix_rename.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261027_ikqy3n_catalog_prefix_rename.sql", import.meta.url),
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
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
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

const RENAMED = new Map([
  ["assets", "user_assets"],
  ["shared_assets", "user_shared_asset_snapshots"],
  ["material_groups", "catalog_material_groups"],
  ["material_assets", "catalog_material_states"],
  ["generation_model_capability", "catalog_models"],
  ["media_tool_pricing", "catalog_media_tools"],
  ["skill", "catalog_skills"],
  ["user_skill", "user_skills"],
  ["creative_skill", "catalog_creative_skills"],
  ["creative_skill_version", "catalog_creative_skill_versions"],
  ["template_card", "catalog_templates"],
  ["template_card_image", "catalog_template_images"],
  ["template_tag", "catalog_template_tags"],
  ["homepage_hero", "content_homepage_heroes"],
]);

const SUPERSEDED_BY_IKRGTJ = new Set(["shared_assets", "material_groups", "material_assets", "media_tool_pricing"]);

const SUPERSEDED_INDEX_RENAMES = new Set(["uk_material_assets_material", "idx_material_assets_poll", "idx_material_assets_group", "uk_media_tool_pricing__tool_type"]);

const SUPERSEDED_BY_IKRJO3 = new Set(["catalog_creative_skills", "catalog_creative_skill_versions"]);

const SUPERSEDED_INDEX_RENAMES_BY_IKRJO3 = new Set(["uk_catalog_creative_skills__creative_skill_id", "uk_catalog_creative_skill_versions__creative_skill_version_id", "uk_catalog_creative_skill_versions__semver"]);

const INDEX_RENAMES = new Map([
  ["uk_media_tool_pricing__tool_type", "uk_catalog_media_tools__tool_type"],
  ["uk_user_skill", "uk_user_skills__user_skill"],
  ["uk_material_assets_material", "uk_catalog_material_states__material"],
  ["idx_material_assets_poll", "idx_catalog_material_states__poll"],
  ["idx_material_assets_group", "idx_catalog_material_states__group"],
  ["uk_creative_skill_id", "uk_catalog_creative_skills__creative_skill_id"],
  ["uk_creative_skill_version_id", "uk_catalog_creative_skill_versions__creative_skill_version_id"],
  ["uk_creative_skill_version_semver", "uk_catalog_creative_skill_versions__semver"],
]);

describe("IKQY3N 三轨迁移（目录/素材/技能与模板表改名）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("14 张表按一条多表 RENAME TABLE 原子改名", () => {
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

  it("Prisma 模型只剩新表名（被后续工单改名/退役的表除外）", () => {
    for (const [from, to] of RENAMED) {
      if (SUPERSEDED_BY_IKRGTJ.has(from)) continue;
      if (SUPERSEDED_BY_IKRJO3.has(to)) continue;
      expect(schemaPrisma).toContain("model " + to + " {");
      expect(schemaPrisma).not.toContain("model " + from + " {");
    }
    for (const [from, to] of INDEX_RENAMES) {
      if (SUPERSEDED_INDEX_RENAMES.has(from)) continue;
      if (SUPERSEDED_INDEX_RENAMES_BY_IKRJO3.has(to)) continue;
      expect(schemaPrisma).not.toContain('"' + from + '"');
      expect(schemaPrisma).toContain('"' + to + '"');
    }
  });

  it("Java 测试 schema 同步新表名（被后续工单改名/退役的表除外）", () => {
    for (const [from, to] of RENAMED) {
      if (SUPERSEDED_BY_IKRGTJ.has(from)) continue;
      if (SUPERSEDED_BY_IKRJO3.has(to)) continue;
      expect(javaSchemaSql).not.toContain("CREATE TABLE `" + from + "`");
      expect(javaSchemaSql).toContain("CREATE TABLE `" + to + "`");
    }
    for (const [from, to] of INDEX_RENAMES) {
      if (SUPERSEDED_INDEX_RENAMES.has(from)) continue;
      if (SUPERSEDED_INDEX_RENAMES_BY_IKRJO3.has(to)) continue;
      expect(javaSchemaSql).not.toContain("`" + from + "`");
      expect(javaSchemaSql).toContain("`" + to + "`");
    }
  });

  it("001_baseline.sql 保持时间点快照", () => {
    expect(baselineSql).toContain("CREATE TABLE `assets`");
    expect(baselineSql).not.toContain("CREATE TABLE `user_assets`");
  });

  it("002_seed.sql 仍用改名前的表名（与 baseline 同批、早于 078 执行）", () => {
    expect(seedSql).toContain("INSERT INTO generation_model_capability");
    expect(seedSql).not.toContain("INSERT INTO catalog_models");
  });

  it("后端生产代码与运维脚本不再访问旧表名", () => {
    const names =
      "assets|skill|user_skill|creative_skill|creative_skill_version|template_card|template_card_image|template_tag|material_groups|material_assets|shared_assets|homepage_hero|generation_model_capability|media_tool_pricing";
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
      "assets|shared_assets|material_groups|material_assets|generation_model_capability|media_tool_pricing|skill|user_skill|creative_skill|creative_skill_version|template_card|template_card_image|template_tag|homepage_hero";
    const reference = new RegExp(
      "(?:@TableName\\(\\\"|\\b(?:FROM|INTO|JOIN|UPDATE|DELETE FROM)\\s+`?)(" + names + ")\\b",
      "i",
    );
    const files = javaSources(join(REPO_ROOT, "server/blue-whale-worker/src/main"));
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      if (reference.test(readFileSync(file, "utf8"))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
