import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261009180000_ikkh81_drop_asset_material_group/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL(
    "../../../prisma/schema/062_ikkh81_drop_asset_material_group.sql",
    import.meta.url,
  ),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL(
    "../../../../docs/sql/20261009_ikkh81_drop_asset_material_group.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

function modelBlock(name: string): string {
  const block = schemaPrisma.match(
    new RegExp("model " + name + " \\{[\\s\\S]*?\\n\\}"),
  )?.[0];
  expect(block).toBeDefined();
  return block!;
}

describe("IKKH81 三轨迁移（assets 去 material_group_id）", () => {
  it("三处逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三处都删列、删索引，且带 charset 保护", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).toContain("DROP COLUMN `material_group_id`");
      expect(sql).toContain("DROP INDEX `idx_asset_material_group`");
      expect(sql).toContain("SET NAMES utf8mb4");
    }
  });

  it("不重新引入该列（反向保护）", () => {
    for (const sql of [migrationSql, standaloneSql, snapshotSql]) {
      expect(sql).not.toContain("ADD COLUMN `material_group_id`");
    }
  });

  it("assets model 已去列与索引，绑定列与唯一键保留", () => {
    const assets = modelBlock("user_assets");
    expect(assets).not.toContain("material_group_id");
    expect(assets).not.toContain("idx_asset_material_group");
    expect(assets).toContain("material_id");
    expect(assets).toContain("uq_asset_material_id");
  });

  it("material_assets model 不动：组列与 NOT NULL 保留（ADR-0126 决策 1）", () => {
    const materialAssets = modelBlock("user_material_info");
    expect(materialAssets).toMatch(
      /material_group_id\s+String\s+@db\.VarChar\(128\)/,
    );
  });
});
