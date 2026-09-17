import { describe, expect, it } from "vitest";

import {
  mapPaymentMethodLabel,
  parseConsumeLogTypes,
  toAccountConsumptionItem,
} from "./records.js";

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
      type: 2,
      quota: 50_000,
      model_name: "doubao-seedream-4-0-250828",
      created_at: 1_700_000_000,
    });
    expect(item.model).toBe("doubao-seedream-4-0-250828");
    expect(item.summary).toBe("生成图片");
    expect(item.id).toBe(7);
    expect(item.kind).toBe("consume");
  });
});

describe("toAccountConsumptionItem（IKGCWU 退款与消耗同列）", () => {
  it("退款标 refund，且 credits 保持正的变动幅度", () => {
    const item = toAccountConsumptionItem({
      id: 12,
      type: 6,
      quota: 300_000,
      model_name: "doubao-seedance-2-0-260128",
      created_at: 1_700_000_100,
    });
    expect(item.kind).toBe("refund");
    expect(item.summary).toBe("退款（生成视频）");
    // 上游退款的 quota 记的是正数（退回量）；这里也保持正幅度，符号由展示端按 kind 决定。
    // 若改成负 credits，展示层的 `-{credits}` 会渲染成 "--12 积分"。
    expect(item.credits).toBeGreaterThan(0);
  });

  it("退款与消耗的 credits 同口径（只差 kind 与摘要）", () => {
    const base = {
      id: 1,
      quota: 120_000,
      model_name: "doubao-seedream-4-0-250828",
      created_at: 1_700_000_000,
    };
    const consume = toAccountConsumptionItem({ ...base, type: 2 });
    const refund = toAccountConsumptionItem({ ...base, type: 6 });
    expect(refund.credits).toBe(consume.credits);
    expect(refund.summary).toBe("退款（生成图片）");
  });
});

describe("parseConsumeLogTypes（IKGCWU type 白名单）", () => {
  it("缺省 → 消耗 + 退款两类都查", () => {
    expect(parseConsumeLogTypes(new URLSearchParams())).toEqual([2, 6]);
  });

  it("空串 → 同样查两类，绝不落进「不过滤」", () => {
    expect(parseConsumeLogTypes(new URLSearchParams("type="))).toEqual([2, 6]);
  });

  it("单个消耗（显式收窄）", () => {
    expect(parseConsumeLogTypes(new URLSearchParams("type=2"))).toEqual([2]);
  });

  it("单个退款", () => {
    expect(parseConsumeLogTypes(new URLSearchParams("type=6"))).toEqual([6]);
  });

  it("消耗 + 退款（显式）", () => {
    expect(parseConsumeLogTypes(new URLSearchParams("type=2,6"))).toEqual([2, 6]);
  });

  it("容忍逗号两侧空白", () => {
    expect(parseConsumeLogTypes(new URLSearchParams("type=2, 6"))).toEqual([2, 6]);
  });

  // 这些值若不拦，上游会落进「不加 type 过滤」分支静默返回全部日志类型
  // （充值/管理/系统/登录全混进消费记录），是个不报错的错答案。
  it.each(["0", "1", "2,7", "abc", "2,", "2;6", "-1", "2,0"])(
    "非白名单值 %s → 抛错",
    (raw) => {
      expect(() =>
        parseConsumeLogTypes(new URLSearchParams(`type=${raw}`)),
      ).toThrowError(/消费记录类型参数非法/);
    },
  );

  it("非法值报 400，不是 500", () => {
    try {
      parseConsumeLogTypes(new URLSearchParams("type=0"));
      throw new Error("应当抛错");
    } catch (error) {
      expect((error as { status?: number }).status).toBe(400);
    }
  });
});
