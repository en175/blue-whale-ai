import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { audioRuleOf } from "./seed-audio-pricing-per-second.fixture";


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

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const OFFICIAL_YUAN_PER_MINUTE = 0.3;
const CREDITS_PER_YUAN = 15;
const MC_PER_CREDIT = 1000;
const OFFICIAL_MAX_OUTPUT_SECONDS = 120;

const EXPECTED_MC_PER_SECOND =
  (OFFICIAL_YUAN_PER_MINUTE / 60) * CREDITS_PER_YUAN * MC_PER_CREDIT;

describe("seed-audio-1.0 计价按秒：三轨迁移", () => {
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

  it("★ 只命中 seed-audio-1.0 的 audio 能力行，且带 is_delete 过滤", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`model_id` = 'seed-audio-1.0'");
    expect(standaloneSql).toContain("`capability_type` = 'audio'");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });
});

describe("seed-audio-1.0 计价按秒：数值就是官方那个数", () => {
  it("★ 单价 = 官方 0.3 元/分钟 折算的 mc/秒", () => {
    expect(EXPECTED_MC_PER_SECOND).toBe(75);
    expect(standaloneSql).toContain(`'value', ${EXPECTED_MC_PER_SECOND}`);
  });

  it("★ 基准维度是 usage.seconds（不是 constant:1）", () => {
    expect(standaloneSql).toContain("'baseUnit', 'usage.seconds'");
    expect(sqlCode).not.toContain("constant:1");
  });

  it("★ 配了 maxCredits —— 没配的话该模型每次提交都会被拒", () => {
    const m = standaloneSql.match(/'maxCredits',\s*(\d+)/);
    expect(m, "迁移里必须显式给 maxCredits").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(
      Math.ceil((OFFICIAL_MAX_OUTPUT_SECONDS * EXPECTED_MC_PER_SECOND) / MC_PER_CREDIT),
    );
  });

  it("分母是 1（每秒口径），不是 1000000", () => {
    expect(standaloneSql).toContain("'unitDenominator', 1");
  });
});

describe("seed-audio-1.0 计价按秒：迁移落下的形态能被引擎读懂", () => {
  it("★ 迁移写下的 JSON 与 fixture 逐字同形", () => {
    expect(audioRuleOf(standaloneSql)).toEqual({
      baseUnit: "usage.seconds",
      basePrice: { kind: "const", value: EXPECTED_MC_PER_SECOND },
      unitDenominator: 1,
      minCredits: 1,
      maxCredits: 12,
    });
  });

  it("★ 用 JSON_OBJECT 整体替换，而不是 JSON_SET 打补丁", () => {
    expect(standaloneSql).toContain("JSON_OBJECT(");
    expect(sqlCode).not.toContain("JSON_SET(");
    expect(sqlCode).not.toContain("JSON_REMOVE(");
  });
});
