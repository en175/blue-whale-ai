// IKDZGM / ADR-0083 阶段1：单一码表契约测试。
// 验证 ERROR_CODE_DEFINITIONS / GLOBAL_CODE_MESSAGES 完整性及查询函数。
// 关键：与 generation-error-codes / account-error-codes 的数值码、文案保持同值（唯一表不漂移）。
import { describe, expect, it } from "vitest";

import {
  ERROR_CODE_DEFINITIONS,
  GLOBAL_CODE_MESSAGES,
  errorCodeDefinition,
  errorCodeMessage,
  globalCodeMessage,
  domainCodeToNumeric,
} from "./error-codes.js";
import {
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  GENERATION_ERROR_NUMERIC_CODES,
} from "./generation-error-codes.js";
import {
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_NUMERIC_CODES,
} from "./account-error-codes.js";

describe("单一码表（IKDZGM / ADR-0083）", () => {
  it("覆盖生成任务全部 code，数值码与 GENERATION_ERROR_NUMERIC_CODES 一致", () => {
    for (const [code, numeric] of Object.entries(GENERATION_ERROR_NUMERIC_CODES)) {
      const def = ERROR_CODE_DEFINITIONS[code];
      expect(def, `${code} 应在单一码表登记`).toBeDefined();
      expect(def!.code, `${code} 数值码应与 generation 表一致`).toBe(numeric);
      expect(def!.message).toBeTruthy();
    }
  });

  it("覆盖账号域全部 code，数值码与 ACCOUNT_ERROR_NUMERIC_CODES 一致", () => {
    for (const [code, numeric] of Object.entries(ACCOUNT_ERROR_NUMERIC_CODES)) {
      const def = ERROR_CODE_DEFINITIONS[code];
      expect(def, `${code} 应在单一码表登记`).toBeDefined();
      expect(def!.code, `${code} 数值码应与 account 表一致`).toBe(numeric);
    }
  });

  it("quota_exhausted = 1001，文案与前端约定一致", () => {
    const def = errorCodeDefinition(ERROR_QUOTA_EXHAUSTED);
    expect(def?.code).toBe(1001);
    expect(def?.message).toBe("账户余额不足，请充值后重试");
  });

  it("errorCodeMessage 返回文案；未登记返回 undefined", () => {
    expect(errorCodeMessage(ERROR_INVALID_INPUT)).toBe("输入参数无效");
    expect(errorCodeMessage("不存在的码")).toBeUndefined();
  });

  it("domainCodeToNumeric：生成域兜底 1000，账号域兜底 1100", () => {
    expect(domainCodeToNumeric(ERROR_QUOTA_EXHAUSTED)).toBe(1001);
    expect(domainCodeToNumeric(ACCOUNT_ERROR_PASSWORD_INCORRECT)).toBe(1101);
    expect(domainCodeToNumeric("unknown_generation")).toBe(1000);
    expect(domainCodeToNumeric("password_unknown")).toBe(1100);
  });

  it("GLOBAL_CODE_MESSAGES 覆盖主要全局业务码", () => {
    expect(globalCodeMessage(100301)).toBe("资源不存在");
    expect(globalCodeMessage(100405)).toBe("余额不足，请充值后重试");
    expect(globalCodeMessage(123456)).toBeUndefined();
  });
});
