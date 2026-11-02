import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261029140000_ikrdnk_retire_scene_cards/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/085_ikrdnk_retire_scene_cards.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261029_ikrdnk_retire_scene_cards.sql", import.meta.url),
  "utf8",
);
const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const TRACKS = [migrationSql, standaloneSql, snapshotSql];

describe("场景卡与分镜预览退役（IKRDNK）", () => {
  it("三轨逐字同源", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("三轨都声明 SET NAMES utf8mb4（charset 回归保护）", () => {
    for (const sql of TRACKS) expect(sql).toContain("SET NAMES utf8mb4");
  });

  it("注释语法合法：`--` 后必须跟空格（MySQL 注释规则）", () => {
    for (const sql of TRACKS) {
      const bad = sql
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .filter((entry) => /^--[^ \-\n]/.test(entry.replace(/^\d+: /, "")));
      expect(bad).toEqual([]);
    }
  });

  it("四张表按子到父的顺序 DROP", () => {
    const order = [
      "DROP TABLE IF EXISTS `scene_card_generation_records`;",
      "DROP TABLE IF EXISTS `scene_card_generation_presets`;",
      "DROP TABLE IF EXISTS `storyboard_previews`;",
      "DROP TABLE IF EXISTS `scene_cards`;",
    ];
    for (const sql of TRACKS) {
      const positions = order.map((statement) => sql.indexOf(statement));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
  });

  it("generation_output_slots 的聚合外键列与索引一并删除", () => {
    for (const sql of TRACKS) {
      expect(sql).toContain("DROP INDEX `idx_slot_record`");
      expect(sql).toContain("DROP COLUMN `scene_card_generation_record_id`");
    }
  });

  it("schema.prisma 不再有这四个 model", () => {
    for (const model of [
      "scene_cards",
      "scene_card_generation_presets",
      "scene_card_generation_records",
      "storyboard_previews",
    ]) {
      expect(schemaPrisma).not.toContain(`model ${model} {`);
    }
  });

  it("schema.prisma 的槽位表不再带场景卡聚合列", () => {
    const model = schemaPrisma.match(
      /model generation_output_slots \{[^}]*\}/,
    )?.[0];
    expect(model).toBeDefined();
    expect(model).not.toContain("scene_card_generation_record_id");
  });
});
