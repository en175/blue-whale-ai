// IKBQEE / ADR-0078 二期：对外数值错误码映射（前端按 code 映射文案的唯一来源）。
// 定义收敛到 error-codes.ts（高内聚），此处直接测它。
import { describe, expect, it } from "vitest";

import {
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  ERROR_PROVIDER_FAILED,
  GENERATION_ERROR_NUMERIC_CODES,
  GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
  RATE_LIMITED,
  ACCOUNT_LOCKED,
  errorCodeToNumeric,
  isContentPolicySignal,
  isQuotaSignal,
} from "./error-codes.js";

describe("generation error numeric codes (external contract)", () => {
  it("关键映射稳定（前端契约）", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_PROVIDER_FAILED]).toBe(1011);
    expect(errorCodeToNumeric(ERROR_QUOTA_EXHAUSTED)).toBe(1001);
  });

  it("数值码在 1xxx 段（与 100xxx SystemCode 段区分）", () => {
    for (const n of Object.values(GENERATION_ERROR_NUMERIC_CODES)) {
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThan(2000);
    }
  });

  it("未知码兜底 1000", () => {
    expect(errorCodeToNumeric("some_unknown_code")).toBe(
      GENERATION_ERROR_UNKNOWN_NUMERIC_CODE,
    );
    expect(GENERATION_ERROR_UNKNOWN_NUMERIC_CODE).toBe(1000);
  });

  it("RATE_LIMITED 是 HTTP 限流字符串码，不占用生成 1xxx 数值表", () => {
    expect(RATE_LIMITED).toBe("rate_limited");
    expect(GENERATION_ERROR_NUMERIC_CODES[RATE_LIMITED]).toBeUndefined();
  });

  it("ACCOUNT_LOCKED 是登录失败锁定字符串码，不占用生成 1xxx 数值表", () => {
    expect(ACCOUNT_LOCKED).toBe("account_locked");
    expect(GENERATION_ERROR_NUMERIC_CODES[ACCOUNT_LOCKED]).toBeUndefined();
  });
});

describe("provider 错误信号（IKDAJN）", () => {
  it("isContentPolicySignal 命中 copyright/sensitive 中英文 keyword", () => {
    expect(
      isContentPolicySignal(
        "The request failed because the output image may be related to copyright restrictions",
      ),
    ).toBe(true);
    expect(
      isContentPolicySignal(
        "The request failed because the output image may contain sensitive information",
      ),
    ).toBe(true);
    expect(isContentPolicySignal("信息可能涉及版权限制，请您更换后重试")).toBe(true);
    expect(isContentPolicySignal("信息可能包含敏感内容，请您更换后重试")).toBe(true);
    expect(isContentPolicySignal("policy violation detected")).toBe(true);
  });

  it("isContentPolicySignal 不误伤欠费/普通文案", () => {
    expect(isContentPolicySignal("预扣费额度失败, 用户剩余额度: ¥0.9")).toBe(false);
    expect(isContentPolicySignal("gateway timeout")).toBe(false);
    expect(isContentPolicySignal("")).toBe(false);
  });

  it("isQuotaSignal 命中欠费 keyword / HTTP 402", () => {
    // IKDQ5F：真欠费锚点 = 预扣费额度失败/剩余额度/额度不足/余额不足。
    expect(
      isQuotaSignal("预扣费额度失败, 用户剩余额度: ¥0.9", 200),
    ).toBe(true);
    expect(isQuotaSignal("账户余额不足，请充值后重试")).toBe(true);
    expect(isQuotaSignal("账户剩余额度不足，请充值后重试")).toBe(true);
    expect(isQuotaSignal("额度不足", 200)).toBe(true);
    expect(isQuotaSignal("precondition payment_required", 500)).toBe(true);
    expect(isQuotaSignal("request failed", 402)).toBe(true);
    expect(isQuotaSignal("balance insufficient")).toBe(true);
  });

  it("isQuotaSignal 不被非用户欠费文案误伤（IKDQ5F）", () => {
    // 渠道无余额 / 无可用渠道 / 超时：非用户欠费，必须 false。
    // 注：「new-api 音频生成余额不足」是我们抛 ERROR_QUOTA_EXHAUSTED 时的固定文案
    // （ADR-0078 message 不泄漏原文），本身就该被 quota 锚点命中——不是本测试的反例。
    expect(isQuotaSignal("当前渠道无余额，请更换渠道", 200)).toBe(false);
    expect(isQuotaSignal("无可用的渠道，请配置渠道后再试", 200)).toBe(false);
    expect(isQuotaSignal("gateway timeout", 503)).toBe(false);
    expect(isQuotaSignal("request timed out", 504)).toBe(false);
  });

  it("isQuotaSignal 不被 content-policy 文案误伤", () => {
    expect(
      isQuotaSignal(
        "The request failed because the output image may be related to copyright restrictions",
        500,
      ),
    ).toBe(false);
    expect(isQuotaSignal("gateway down", 503)).toBe(false);
  });
});
