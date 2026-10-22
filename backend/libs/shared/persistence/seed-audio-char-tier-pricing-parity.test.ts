import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pricingFieldErr } from "../model-capability/constants";

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20261022130000_ikppc3_seed_audio_char_tier_pricing/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/075_ikppc3_seed_audio_char_tier_pricing.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20261022_ikppc3_seed_audio_char_tier_pricing.sql", import.meta.url),
  "utf8",
);

const sqlCode = standaloneSql.replace(/^\s*--.*$/gm, "");

const RULE = {
  baseUnit: "usage.characters",
  basePrice: { kind: "const", value: 19000 },
  unitDenominator: 100,
  quantityStep: 100,
  rounding: "halfUp",
  minCredits: 1,
} as const;

describe("seed-audio-1.0 按 100 字分档计费：三轨迁移", () => {
  it("三轨逐字一致", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4，且是纯数据迁移", () => {
    expect(standaloneSql).toContain("SET NAMES utf8mb4");
    expect(sqlCode).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
  });

  it("只命中 seed-audio-1.0 的 audio 能力行", () => {
    expect(sqlCode.match(/UPDATE\s+`generation_model_capability`/g) ?? []).toHaveLength(1);
    expect(standaloneSql).toContain("`model_id` = 'seed-audio-1.0'");
    expect(standaloneSql).toContain("`capability_type` = 'audio'");
    expect(standaloneSql).toContain("`is_delete` = 0");
  });
});

describe("seed-audio-1.0 按 100 字分档计费：规则形状", () => {
  it("★ 基准维度是 usage.characters", () => {
    expect(standaloneSql).toContain("'baseUnit', 'usage.characters'");
    expect(sqlCode).not.toContain("usage.seconds");
  });

  it("★ 19 积分 / 100 字：单价 19000mc、分母 100、每 100 字一档", () => {
    expect(standaloneSql).toContain("'value', 19000");
    expect(standaloneSql).toContain("'unitDenominator', 100");
    expect(standaloneSql).toContain("'quantityStep', 100");
  });

  it("★ 字数在提交时刻已知，不再需要 maxCredits", () => {
    expect(standaloneSql).not.toContain("maxCredits");
  });

  it("★ 参考素材不额外收费：没有 dims / dimPrices", () => {
    expect(standaloneSql).not.toContain("dimPrices");
    expect(standaloneSql).not.toContain("'dims'");
  });

  it("规则能通过管理端校验", () => {
    expect(pricingFieldErr(RULE, "new-api")).toBeNull();
  });
});
