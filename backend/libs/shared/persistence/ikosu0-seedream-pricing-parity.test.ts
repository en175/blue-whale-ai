import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261019130000_ikosu0_seedream_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/067_ikosu0_seedream_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261019_ikosu0_seedream_pricing.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const updates = sqlCode
  .split(/;\s*\n/)
  .map((block) => block.trim())
  .filter((block) => /^UPDATE `generation_model_capability`/.test(block));

function blocksOf(modelId: string): string[] {
  return updates.filter((block) => block.includes(`\`model_id\` = '${modelId}'`));
}

describe("IKOSU0 seedream 价目迁移：三轨", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且不写注释", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(standaloneSql).not.toMatch(/^\s*--/m);
  });

  it("★ 是纯数据迁移：没有任何 DDL", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 五个 UPDATE，全部带 is_delete 过滤、对象守卫并递增 version", () => {
    expect(updates).toHaveLength(5);
    for (const block of updates) {
      expect(block).toContain("`capability_type` = 'image'");
      expect(block).toContain("`is_delete` = 0");
      expect(block).toContain("`version` = `version` + 1");
    }
    expect(sqlCode).toContain("START TRANSACTION");
    expect(sqlCode).toContain("COMMIT");
  });
});

describe("IKOSU0 seedream 价目迁移：5.0 Pro 分价", () => {
  it("★ 文生/图生按 size × image_reference 查表，六个键齐全", () => {
    const blocks = blocksOf("doubao-seedream-5-0-pro-260628");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    expect(block).toContain("'baseUnit', 'usage.succeededSlots'");
    expect(block).toContain("'by', JSON_ARRAY('size', 'image_reference')");
    for (const entry of [
      "'size=1k|image_reference=0', 7000",
      "'size=1.5k|image_reference=0', 8000",
      "'size=2k|image_reference=0', 14000",
      "'size=1k|image_reference=1', 9000",
      "'size=1.5k|image_reference=1', 10000",
      "'size=2k|image_reference=1', 16000",
    ]) {
      expect(block).toContain(entry);
    }
    expect(block).not.toContain("dimPrices");
    expect(block).not.toContain("firstFree");
    expect(block).toContain("JSON_TYPE(`pricing`) = 'OBJECT'");
  });
});

describe("IKOSU0 seedream 价目迁移：5.0 Lite", () => {
  it("★ 单价改为 const 4000", () => {
    const blocks = blocksOf("doubao-seedream-5-0-260128");
    const priceBlock = blocks.find((block) => block.includes("'$.basePrice'"));
    expect(priceBlock).toBeDefined();
    expect(priceBlock).toContain(
      "JSON_OBJECT('kind', 'const', 'value', 4000)",
    );
  });

  it("★ 3K/4K 尺寸按幂等方式追加：缺才追加，array 才追加", () => {
    const blocks = blocksOf("doubao-seedream-5-0-260128");
    const sizeBlocks = blocks.filter((block) => block.includes("JSON_ARRAY_APPEND"));
    expect(sizeBlocks).toHaveLength(2);
    expect(sizeBlocks[0]).toContain('"id":"3k"');
    expect(sizeBlocks[1]).toContain('"id":"4k"');
    for (const block of sizeBlocks) {
      expect(block).toContain("JSON_TYPE(`supported_sizes`) = 'ARRAY'");
      expect(block).toContain("JSON_SEARCH(`supported_sizes`, 'one'");
    }
  });
});

describe("IKOSU0 seedream 价目迁移：4.5 按张", () => {
  it("★ baseUnit 改为 succeededSlots，单价改为 4000（4 积分/张）", () => {
    const blocks = blocksOf("doubao-seedream-4-5-251128");
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;

    expect(block).toContain("'$.baseUnit', 'usage.succeededSlots'");
    expect(block).toContain(
      "'$.basePrice', JSON_OBJECT('kind', 'const', 'value', 4000)",
    );
    expect(block).not.toContain("3750");
    expect(block).toContain("JSON_TYPE(`pricing`) = 'OBJECT'");
  });
});
