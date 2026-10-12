import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ERROR_PLATFORM_QUOTA_EXHAUSTED,
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

const generationErrorJava = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/domain/error/GenerationError.java",
    import.meta.url,
  ),
  "utf8",
);

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

describe("GenerationError.java ↔ TS 码表 parity（ADR-0128）", () => {
  const javaConstants = new Map<string, string>();
  for (const m of generationErrorJava.matchAll(
    /String\s+(ERROR_[A-Z0-9_]+)\s*=\s*"([^"]*)"/g,
  )) {
    javaConstants.set(m[1]!, m[2]!);
  }

  it("平台额度不足：Java 字符串码与 TS 逐字一致，数值码 1061", () => {
    expect(javaConstants.get("ERROR_PLATFORM_QUOTA_EXHAUSTED")).toBe(
      ERROR_PLATFORM_QUOTA_EXHAUSTED,
    );
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_PLATFORM_QUOTA_EXHAUSTED]).toBe(1061);
  });

  it("Java 侧不再有旧码 quota_exhausted（收窄为个人侧专属）", () => {
    const values = [...javaConstants.values()];
    expect(values).not.toContain(ERROR_QUOTA_EXHAUSTED);
  });

  it("Java 每个错误常量都在 TS 数值表里有映射（防漏同步）", () => {
    for (const [name, value] of javaConstants) {
      expect(
        GENERATION_ERROR_NUMERIC_CODES[value],
        `${name} = "${value}" 在 TS 数值表里没有映射`,
      ).toBeTypeOf("number");
    }
  });
});
