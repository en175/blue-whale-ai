import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { audioRuleOf } from "./seed-audio-pricing-per-second.fixture";

/**
 * 音频计价改「按产出秒数」的三轨迁移核对。
 *
 * 这条迁移改的是**数据**（`pricing` 列的一个 JSON），不是结构 —— 但它是**钱**：
 * 改错了不会报错，只会让每一次音频生成收错钱。所以守卫全部指向「这次的数值
 * 是不是官方那个数」与「它能不能被 billing 真的算出来」两件事。
 */

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260926140000_seed_audio_pricing_per_second/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/043_seed_audio_pricing_per_second.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260926_seed_audio_pricing_per_second.sql", import.meta.url),
  "utf8",
);

/**
 * 去掉 `--` 行注释后的**可执行 SQL**。
 *
 * ⚠️ 「不含某个词」这类断言一律要打在它上面，不能打在原文上：这条迁移的注释里
 * 正当地提到了 `constant:1`（说明「原值就是那个，为什么要换掉」）。
 * 拿原文去断言 `not.toContain` 会把「解释得清楚」判成「违规」——
 * 那种守卫的下场是有人为了让它变绿而把注释删掉，正好把最该留的信息删了。
 */
const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

/** 官方口径：0.3 元/分钟。 */
const OFFICIAL_YUAN_PER_MINUTE = 0.3;
/** 1 元 = 15 积分（catalog v12）；1 积分 = 1000 mc —— 与 basePrice.value 的单位一致。 */
const CREDITS_PER_YUAN = 15;
const MC_PER_CREDIT = 1000;
/** 官方单次输出上限 2 分钟。 */
const OFFICIAL_MAX_OUTPUT_SECONDS = 120;

/** 官方单价折算成 mc/秒。**这是本迁移唯一的数字，写成算式而不是字面量。 */
const EXPECTED_MC_PER_SECOND =
  (OFFICIAL_YUAN_PER_MINUTE / 60) * CREDITS_PER_YUAN * MC_PER_CREDIT; // = 75

describe("seed-audio-1.0 计价按秒：三轨迁移", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
  });

  it("★ 是纯数据迁移：没有任何 DDL", () => {
    // 这条迁移只改 `pricing` 列的值。出现 ALTER / CREATE / DROP / ADD COLUMN
    // 意味着有人把一次结构变更夹带进来了 —— 那必须各自成一条迁移（见三轨约定）。
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
    expect(sqlCode).not.toMatch(/ADD COLUMN/i);
  });

  it("★ 只命中 seed-audio-1.0 的 audio 能力行，且带 is_delete 过滤", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(1);
    // 软删行不该被这条 UPDATE 碰到（改到它们不影响线上，但会让「重建库」与线上分叉）
    expect(standaloneSql).toContain("`model_id` = 'seed-audio-1.0'");
    expect(standaloneSql).toContain("`capability_type` = 'audio'");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });
});

describe("seed-audio-1.0 计价按秒：数值就是官方那个数", () => {
  it("★ 单价 = 官方 0.3 元/分钟 折算的 mc/秒", () => {
    // 0.3 元/分钟 ÷ 60 × 15 积分/元 × 1000 = 75 mc/秒。
    // 钉住这一条：这个数改一位，音频就整体按错误倍数收钱，且不会有任何报错。
    expect(EXPECTED_MC_PER_SECOND).toBe(75);
    expect(standaloneSql).toContain(`'value', ${EXPECTED_MC_PER_SECOND}`);
  });

  it("★ 基准维度是 usage.seconds（不是 constant:1）", () => {
    // 原值 constant:1 是「按次」——与实际时长无关，短音频超收几十倍。
    // 这条迁移存在**全部意义**就是把它换掉，所以正反两面都钉。
    expect(standaloneSql).toContain("'baseUnit', 'usage.seconds'");
    expect(sqlCode).not.toContain("constant:1");
  });

  it("★ 配了 maxCredits —— 没配的话该模型每次提交都会被拒", () => {
    // 按秒的基准量在提交时刻取不到（TTS 时长由文案决定，请求里没有 duration），
    // billing 只有「规则配了上限」才转「按上限冻结、按实际结算」，否则直接拒单（400）。
    // 所以 maxCredits 在这里不是调优项，是这个规则**能不能用**的前提。
    const m = standaloneSql.match(/'maxCredits',\s*(\d+)/);
    expect(m, "迁移里必须显式给 maxCredits").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(
      Math.ceil((OFFICIAL_MAX_OUTPUT_SECONDS * EXPECTED_MC_PER_SECOND) / MC_PER_CREDIT),
    );
  });

  it("分母是 1（每秒口径），不是 1000000", () => {
    // unitDenominator ≠ 1 只在「每百万 token」下有意义；音频写在按秒的规则里
    // 会把单价缩小一百万倍 —— 而闸门（pricingFieldErr）只在同时有 tokenEstimate 时放行 ≠1，
    // 音频没有 tokenEstimate，所以写错会被写闸门拒。这里再钉一次，防有人改闸门时忘了音频。
    expect(standaloneSql).toContain("'unitDenominator', 1");
  });
});

describe("seed-audio-1.0 计价按秒：迁移落下的形态能被引擎读懂", () => {
  it("★ 迁移写下的 JSON 与 fixture 逐字同形", () => {
    // fixture 是「这条规则在库里的样子」的单一副本，其余断言都读它 ——
    // 这样守卫检的是**规则本身**，而不是 SQL 里的字符串顺序。
    expect(audioRuleOf(standaloneSql)).toEqual({
      baseUnit: "usage.seconds",
      basePrice: { kind: "const", value: EXPECTED_MC_PER_SECOND },
      unitDenominator: 1,
      minCredits: 1,
      maxCredits: 12,
    });
  });

  it("★ 用 JSON_OBJECT 整体替换，而不是 JSON_SET 打补丁", () => {
    // 这条规则是**换形态**（constant:1 → usage.seconds），不是改一个数字。
    // JSON_SET 会把旧键留下来（例如某次运营加过的 dims/multipliers），
    // 那些键在新形态下没人读，却会跟着规则快照冻进每一条预留行。
    // 整体替换 = 落下的就是上面 fixture 那**恰好五个键**，没有残留。
    expect(standaloneSql).toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});
