import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260831120000_e_layer_decimal_duration/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const baselineSql = readFileSync(
  new URL("../../../prisma/schema/001_baseline.sql", import.meta.url),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/011_e_layer_decimal_duration.sql", import.meta.url),
  "utf8",
);

describe("E 层双轨迁移（topup_tiers decimal + assets.duration 合并）", () => {
  it("E1：两轨都先回填 duration→duration_ms 再 DROP duration（顺序不可反）", () => {
    const backfill =
      "UPDATE `assets` SET `duration_ms` = `duration` * 1000";
    for (const sql of [migrationSql, standaloneSql]) {
      expect(sql).toContain(backfill);
      expect(sql).toContain("ALTER TABLE `assets` DROP COLUMN `duration`");
      expect(sql.indexOf(backfill)).toBeLessThan(
        sql.indexOf("DROP COLUMN `duration`"),
      );
    }
    expect(baselineSql).toContain("`duration_ms` INTEGER NULL");
    expect(baselineSql).not.toContain("`duration` INTEGER NULL");
  });

  it("E2：topup_tiers 三列转 DECIMAL 双轨一致（original_price/price 10,2；discount 5,4）", () => {
    const mods = [
      "MODIFY COLUMN `original_price` DECIMAL(10, 2) NOT NULL",
      "MODIFY COLUMN `discount` DECIMAL(5, 4) NOT NULL DEFAULT 1",
      "MODIFY COLUMN `price` DECIMAL(10, 2) NOT NULL",
    ];
    for (const sql of [migrationSql, standaloneSql]) {
      for (const mod of mods) expect(sql).toContain(mod);
    }
    expect(baselineSql).toContain("`original_price` DECIMAL(10, 2) NOT NULL");
    expect(baselineSql).toContain("`discount` DECIMAL(5, 4) NOT NULL DEFAULT 1");
    expect(baselineSql).toContain("`price` DECIMAL(10, 2) NOT NULL");
    expect(baselineSql).not.toContain("`original_price` DOUBLE");
    expect(baselineSql).not.toContain("`price` DOUBLE");
  });

  it("前置校验：断言回填候选与精度检查注释存在（人工确认项）", () => {
    const probe =
      "SELECT COUNT(*) FROM assets WHERE duration_ms IS NULL AND duration IS NOT NULL";
    expect(migrationSql).toContain(probe);
    expect(standaloneSql).toContain(probe);
    expect(migrationSql).toContain("ROUND(original_price,2) <> original_price");
    expect(migrationSql).toContain("discount < 0 OR discount > 1");
  });
});
