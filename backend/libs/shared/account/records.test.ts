import { describe, expect, it } from "vitest";

import { mapPaymentMethodLabel, toAccountConsumptionItem } from "./records.js";

describe("mapPaymentMethodLabel（IKBVQQ 渠道族值 → 展示文案）", () => {
  it("wxpay → 微信", () => {
    expect(mapPaymentMethodLabel("wxpay")).toBe("微信");
  });

  it("wechat → 微信（档位流旧值）", () => {
    expect(mapPaymentMethodLabel("wechat")).toBe("微信");
  });

  it("alipay → 支付宝", () => {
    expect(mapPaymentMethodLabel("alipay")).toBe("支付宝");
  });

  it("bluewhalepay → 扫码支付（存量）", () => {
    expect(mapPaymentMethodLabel("bluewhalepay")).toBe("扫码支付");
  });
});

describe("toAccountConsumptionItem（IKBVQQ 透传真实模型名）", () => {
  it("返回 Go 原模型名，不只给类型摘要", () => {
    const item = toAccountConsumptionItem({
      id: 7,
      quota: 50_000,
      model_name: "doubao-seedream-4-0-250828",
      created_at: 1_700_000_000,
    });
    expect(item.model).toBe("doubao-seedream-4-0-250828");
    expect(item.summary).toBe("生成图片");
    expect(item.id).toBe(7);
  });
});
