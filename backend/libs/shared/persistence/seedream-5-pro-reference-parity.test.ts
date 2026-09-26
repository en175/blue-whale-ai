import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Seedream 5.0 Pro 补上参考图计费（`dimPrices`）的三轨迁移核对。
 *
 * 这条迁移加的是**钱**：它让「首张免费、第 2 张起 0.02 元/张」这一项真的收得到。
 * 守卫因此指向三件事：数值是不是官方那个数、**首张免费**在不在、以及
 * 输出档有没有被顺手改坏（那部分本来就是对的，本迁移不该动它）。
 */

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926180000_seedream_5_pro_reference_images/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/045_seedream_5_pro_reference_images.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_seedream_5_pro_reference_images.sql", import.meta.url),
  "utf8",
);

/** 去掉 `--` 行注释后的可执行 SQL（「不含某词」类断言一律打在这上面）。 */
const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

/** 官方：参考图第 2 张起 0.02 元/张。1 元 = 15 积分，1 积分 = 1000 mc。 */
const OFFICIAL_YUAN_PER_EXTRA_REF = 0.02;
const CREDITS_PER_YUAN = 15;
const MC_PER_CREDIT = 1000;
const EXPECTED_UNIT_MC = OFFICIAL_YUAN_PER_EXTRA_REF * CREDITS_PER_YUAN * MC_PER_CREDIT; // 300

describe("seedream-5.0-pro 参考图计费：三轨迁移", () => {
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

  it("★ 只命中 seedream 5.0 Pro 的 image 行，且带 is_delete 过滤", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`model_id` = 'doubao-seedream-5-0-pro-260628'");
    expect(standaloneSql).toContain("`capability_type` = 'image'");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });

  it("★ 整块替换，不是打补丁", () => {
    // 这条改的是**形态**（多出一项计费），不是改一个数字。JSON_SET 会把没提到的旧键
    // 留下来，而它们会跟着规则快照冻进每一条预留行。
    expect(standaloneSql).toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});

describe("seedream-5.0-pro 参考图计费：数值与语义", () => {
  it("★ 参考图单价 = 官方 0.02 元/张 折算的 mc", () => {
    expect(EXPECTED_UNIT_MC).toBe(300);
    expect(standaloneSql).toContain(`'unitMc', ${EXPECTED_UNIT_MC}`);
  });

  it("★ firstFree 为 TRUE —— 「首张免费」不带这个就是多收第一张", () => {
    // 少了它，线性公式给的是 n 而不是 n-1：**每一单都多收 0.02 元**。
    // 而且它是静默的（金额看起来完全合理），所以正反两面都钉。
    expect(sqlCode).toMatch(/'firstFree',\s*TRUE/i);
    expect(sqlCode).not.toMatch(/'firstFree',\s*FALSE/i);
  });

  it("★ 加在 usage.referenceCount 上 —— 参考图的维度键", () => {
    expect(standaloneSql).toContain("'usage.referenceCount'");
  });

  it("★ 与 maxCredits 不同时出现（上限计价算不到绝对加价，会静默少收）", () => {
    expect(sqlCode).not.toContain("maxCredits");
  });

  it("★ 输出档一个数都不动 —— 那部分本来就是对的", () => {
    // 迁移只该**加**第二项。顺手改输出档会让「本来对的」变成「看起来对」。
    // 1k/1.5k = 1536² = 235.9 万像素 ≤ 236 万 → 0.3 元；2k = 419 万 > 236 万 → 0.6 元
    // 4500 mc = 0.3 元；9000 mc = 0.6 元
    expect(standaloneSql).toContain("'size=1k', 4500");
    expect(standaloneSql).toContain("'size=1.5k', 4500");
    expect(standaloneSql).toContain("'size=2k', 9000");
  });

  it("★ 基准维度仍是 usage.succeededSlots（按张数的输出图）", () => {
    expect(standaloneSql).toContain("'baseUnit', 'usage.succeededSlots'");
  });
});
