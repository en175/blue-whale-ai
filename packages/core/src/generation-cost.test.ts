// IK7G9X：成本换算纯函数单测。覆盖默认/覆盖 env、quota→fen 边界、版本字段组装。
import { describe, expect, it } from "vitest";

import {
  buildCostVersions,
  loadGenerationCostConfig,
  quotaToFen,
} from "./generation-cost.js";

describe("loadGenerationCostConfig", () => {
  it("缺省 env 用对齐 new-api 的默认值", () => {
    const config = loadGenerationCostConfig({});
    expect(config).toEqual({
      quotaPerUnit: 500_000,
      usdExchangeRate: 7.3,
      catalogVersion: "v1",
    });
  });

  it("覆盖 env 生效", () => {
    const config = loadGenerationCostConfig({
      QUOTA_PER_UNIT: "1000",
      USD_EXCHANGE_RATE: "7.1",
      GENERATION_COST_CATALOG_VERSION: "v2",
    });
    expect(config).toEqual({
      quotaPerUnit: 1000,
      usdExchangeRate: 7.1,
      catalogVersion: "v2",
    });
  });

  it("非法值回落默认", () => {
    const config = loadGenerationCostConfig({
      QUOTA_PER_UNIT: "abc",
      USD_EXCHANGE_RATE: "-1",
    });
    expect(config.quotaPerUnit).toBe(500_000);
    expect(config.usdExchangeRate).toBe(7.3);
  });
});

describe("quotaToFen", () => {
  const config = loadGenerationCostConfig({});

  it("默认口径：quota=QuotaPerUnit 时 = 汇率×100 分", () => {
    expect(quotaToFen(500_000, config)).toBe(730n); // 1 美元 = 7.3 元 = 730 分
  });

  it("半单位：round 到整数分", () => {
    expect(quotaToFen(250_000, config)).toBe(365n); // 0.5 美元 = 3.65 元 = 365 分
  });

  it("非正/非法 → 0n", () => {
    expect(quotaToFen(0, config)).toBe(0n);
    expect(quotaToFen(-5, config)).toBe(0n);
    expect(quotaToFen(Number.NaN, config)).toBe(0n);
  });
});

describe("buildCostVersions", () => {
  const config = loadGenerationCostConfig({});

  it("用传入 pricing_version 与汇率版本，缺失回落 catalogVersion", () => {
    const versions = buildCostVersions(config, "pricing-v9");
    expect(versions).toEqual({
      priceCatalogVersion: "pricing-v9",
      exchangeRateVersion: "usd-7.3",
      modelPolicyVersion: "v1",
      costRuleVersion: "v1",
    });
  });

  it("model_policy_version 优先用传入值", () => {
    const versions = buildCostVersions(config, undefined, "expr-v2");
    expect(versions.modelPolicyVersion).toBe("expr-v2");
  });

  it("pricing_version 缺失回落 catalogVersion", () => {
    const versions = buildCostVersions(config);
    expect(versions.priceCatalogVersion).toBe("v1");
  });
});
