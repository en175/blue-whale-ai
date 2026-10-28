import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261027150000_ikqy33_project_node_tables/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/076_ikqy33_project_node_tables.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261027_ikqy33_project_node_tables.sql", import.meta.url),
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

const NEW_TABLES = ["project_nodes", "project_edges", "project_node_revisions"];

function tableBlock(sql: string, table: string): string | undefined {
  return sql.match(new RegExp("CREATE TABLE `" + table + "`[^;]*;"))?.[0];
}

function modelBlock(source: string, model: string): string | undefined {
  return source.match(new RegExp("model " + model + " \\{[^}]*\\}"))?.[0];
}

describe("IKQY33 三轨迁移（画布节点行表与 project_ 前缀）", () => {
  it("三处 SQL 逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it.each(NEW_TABLES)("三处都建表 %s", (table) => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      const block = tableBlock(sql, table);
      expect(block).toBeDefined();
      expect(block).toContain("DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    }
  });

  it("Prisma 模型与建表语句列名一致", () => {
    for (const table of NEW_TABLES) {
      const block = tableBlock(migrationSql, table)!;
      const sqlColumns = [...block.matchAll(/^\s+`([a-z_]+)`\s/gm)].map((m) => m[1]);
      const model = modelBlock(schemaPrisma, table);
      expect(model).toBeDefined();
      const modelColumns = [...model!.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]);
      expect(modelColumns.slice(0, sqlColumns.length)).toEqual(sqlColumns);
    }
  });

  it.each(["project_nodes", "project_edges", "project_node_revisions"])(
    "schema.prisma 索引名与 SQL 一致 %s",
    (table) => {
      const block = tableBlock(migrationSql, table)!;
      const indexNames = [...block.matchAll(/(?:UNIQUE )?INDEX `([a-z_]+)`/g)].map((m) => m[1]);
      expect(indexNames.length).toBeGreaterThan(0);
      const model = modelBlock(schemaPrisma, table)!;
      for (const name of indexNames) {
        expect(model).toContain(`map: "${name}"`);
      }
    },
  );

  it("表改名覆盖旧表与旧索引，索引改名先于表改名", () => {
    expect(migrationSql).toContain(
      "ALTER TABLE `canvas` RENAME INDEX `uk_canvas_project` TO `uk_project_canvas__project`",
    );
    expect(migrationSql).toContain(
      "ALTER TABLE `prompt_preview_snapshots` RENAME INDEX `uk_prompt_preview_source` TO `uk_project_prompt_preview_snapshots__source`",
    );
    expect(migrationSql).toContain(
      "RENAME TABLE `canvas` TO `project_canvas`, `prompt_preview_snapshots` TO `project_prompt_preview_snapshots`",
    );
    expect(migrationSql.indexOf("RENAME TABLE")).toBeGreaterThan(
      migrationSql.lastIndexOf("RENAME INDEX"),
    );
    expect(schemaPrisma).toContain("model project_canvas {");
    expect(schemaPrisma).toContain("model project_prompt_preview_snapshots {");
    expect(schemaPrisma).not.toContain("model canvas {");
    expect(schemaPrisma).not.toContain("model prompt_preview_snapshots {");
  });

  it("001_baseline.sql 保持时间点快照不参与改名", () => {
    expect(baselineSql).toContain("CREATE TABLE `canvas`");
    expect(baselineSql).not.toContain("CREATE TABLE `project_canvas`");
  });

  it("Java 测试 schema 同步改名并包含新表", () => {
    expect(javaSchemaSql).toContain("CREATE TABLE `project_canvas`");
    expect(javaSchemaSql).toContain("CREATE TABLE `project_prompt_preview_snapshots`");
    for (const table of NEW_TABLES) {
      expect(javaSchemaSql).toContain("CREATE TABLE `" + table + "`");
    }
  });
});
