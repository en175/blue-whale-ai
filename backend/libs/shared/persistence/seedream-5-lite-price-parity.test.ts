import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Seedream 5.0 Lite 输出单价改 0.22 元/张 的三轨迁移核对。
 *
 * 守卫指向两件事：**数值是不是官方那个数**、以及**形态有没有退回去**
 * （原值挂在一条没有任何读方的尺寸轴上）。
 */

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

/** 去掉 `--` 行注释后的可执行 SQL（「不含某词」类断言一律打在这上面）。 */
const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

/** 官方口径：0.22 元/张；1 元 = 15 积分；1 积分 = 1000 mc（basePrice.value 的单位）。 */
const OFFICIAL_YUAN_PER_IMAGE = 0.22;
const CREDITS_PER_YUAN = 15;
const MC_PER_CREDIT = 1000;
const EXPECTED_MC_PER_IMAGE = OFFICIAL_YUAN_PER_IMAGE * CREDITS_PER_YUAN * MC_PER_CREDIT; // 3300

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
    // 组图一次出多张（官方计费就是「每张 0.22 元」）。写成 constant:1 会让
    // 「一次出 15 张」只收一张的钱 —— 而那个错在账面上看不出来。
    expect(standaloneSql).toContain("'baseUnit', 'usage.succeededSlots'");
    expect(sqlCode).not.toContain("constant:1");
  });

  it("★ 收成常数，不再挂尺寸轴（官方按张计费，与尺寸无关）", () => {
    // 原值 `basePrice.by:["size"]` 的三个档填的是同一个数 —— 那根轴没有读方。
    // 留在那里会让下一个读配置的人以为「尺寸影响价格」。
    expect(standaloneSql).toContain("'kind', 'const'");
    expect(sqlCode).not.toContain("'table'");
    expect(sqlCode).not.toContain("'by'");
  });

  it("★ 用 JSON_OBJECT 整体替换，不是 JSON_SET 打补丁", () => {
    // 换的是形态（table → const），打补丁会把 `by` / `table` 这些旧键留下来，
    // 它们在新形态下没人读，却会跟着规则快照冻进每一条预留行。
    expect(standaloneSql).toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});
