import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";


const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926160000_seedream_5_lite_official_price/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/044_seedream_5_lite_official_price.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_seedream_5_lite_official_price.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const OFFICIAL_YUAN_PER_IMAGE = 0.22;
const CREDITS_PER_YUAN = 15;
const MC_PER_CREDIT = 1000;
const EXPECTED_MC_PER_IMAGE = OFFICIAL_YUAN_PER_IMAGE * CREDITS_PER_YUAN * MC_PER_CREDIT;

describe("seedream-5.0-lite 输出单价：三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 是纯数据迁移：没有任何 DDL", () => {
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 只命中 seedream 5.0 Lite 的 image 行，且带 is_delete 过滤", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`model_id` = 'doubao-seedream-5-0-260128'");
    expect(standaloneSql).toContain("`capability_type` = 'image'");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });
});

describe("seedream-5.0-lite 输出单价：数值就是官方那个数", () => {
  it("★ 单价 = 官方 0.22 元/张 折算的 mc", () => {
    expect(EXPECTED_MC_PER_IMAGE).toBe(3300);
    expect(standaloneSql).toContain(`'value', ${EXPECTED_MC_PER_IMAGE}`);
  });

  it("★ 基准维度是 usage.succeededSlots —— Lite 支持组图，必须按**张**收", () => {
    expect(standaloneSql).toContain("'baseUnit', 'usage.succeededSlots'");
    expect(sqlCode).not.toContain("constant:1");
  });

  it("★ 收成常数，不再挂尺寸轴（官方按张计费，与尺寸无关）", () => {
    expect(standaloneSql).toContain("'kind', 'const'");
    expect(sqlCode).not.toContain("'table'");
    expect(sqlCode).not.toContain("'by'");
  });

  it("★ 用 JSON_OBJECT 整体替换，不是 JSON_SET 打补丁", () => {
    expect(standaloneSql).toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});
