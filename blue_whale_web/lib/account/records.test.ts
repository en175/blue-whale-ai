import { describe, expect, it } from "vitest";

import {
  consumeCredits,
  mapPaymentMethodLabel,
  mapTopUpStatus,
  parseRecordPaging,
  summarizeConsumption,
  topUpCreditsGained,
} from "./records";

describe("mapTopUpStatus", () => {
  it("success → 成功；failed/expired → 失败；其余（pending/未知）→ 进行中", () => {
    expect(mapTopUpStatus("success")).toBe("success");
    expect(mapTopUpStatus("failed")).toBe("failed");
    expect(mapTopUpStatus("expired")).toBe("failed");
    expect(mapTopUpStatus("pending")).toBe("pending");
    expect(mapTopUpStatus("")).toBe("pending");
  });
});

describe("mapPaymentMethodLabel", () => {
  it("已知方式映射文案；bluewhalepay 无法区分渠道显示扫码支付", () => {
    expect(mapPaymentMethodLabel("wechat")).toBe("微信");
    expect(mapPaymentMethodLabel("alipay")).toBe("支付宝");
    expect(mapPaymentMethodLabel("bluewhalepay")).toBe("扫码支付");
    expect(mapPaymentMethodLabel("stripe")).toBe("其他");
    expect(mapPaymentMethodLabel("")).toBe("其他");
  });
});

describe("积分换算（与余额展示同口径 quota × 0.00001）", () => {
  it("充值到账 = N × QuotaPerUnit × 系数：N=10 → 50 积分", () => {
    expect(topUpCreditsGained(10)).toBe(50);
    expect(topUpCreditsGained(60)).toBe(300);
  });

  it("充值 amount 非法 → 0", () => {
    expect(topUpCreditsGained(0)).toBe(0);
    expect(topUpCreditsGained(Number.NaN)).toBe(0);
  });

  it("消费 quota → 积分保留 2 位小数；非法 → 0", () => {
    expect(consumeCredits(1_200_000)).toBe(12);
    expect(consumeCredits(120_000)).toBe(1.2);
    expect(consumeCredits(42_857)).toBe(0.43);
    expect(consumeCredits(10_000)).toBe(0.1);
    expect(consumeCredits(0)).toBe(0);
    expect(consumeCredits(Number.NaN)).toBe(0);
  });
});

describe("parseRecordPaging", () => {
  it("合法参数透传；缺省/非法回落第 1 页 20 条；page_size 上限 100", () => {
    expect(parseRecordPaging(new URLSearchParams("p=2&page_size=30"))).toEqual({
      page: 2,
      pageSize: 30,
    });
    expect(parseRecordPaging(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(
      parseRecordPaging(new URLSearchParams("p=-1&page_size=abc")),
    ).toEqual({
      page: 1,
      pageSize: 20,
    });
    expect(parseRecordPaging(new URLSearchParams("page_size=9999"))).toEqual({
      page: 1,
      pageSize: 100,
    });
  });
});

describe("summarizeConsumption（简单版模型名映射）", () => {
  it("seedream 系 → 生成图片；seedance 系 → 生成视频；其余兜底", () => {
    expect(summarizeConsumption("doubao-seedream-4-0-250828")).toBe("生成图片");
    expect(summarizeConsumption("doubao-seedance-2-0-260128")).toBe("生成视频");
    expect(summarizeConsumption("gpt-4o")).toBe("内容生成");
    expect(summarizeConsumption("")).toBe("内容生成");
  });
});
