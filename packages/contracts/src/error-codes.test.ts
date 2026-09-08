// IKDZGM / ADR-0083：单一码表契约测试。
// 验证 ERROR_CODES（数字码→中文）完整性：一码一文案、覆盖生成域/账号域/全局码。
// 关键：与生成域/账号域数值码保持一致（唯一表不漂移）。
import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  errorMessage,
  messageOf,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  GENERATION_ERROR_NUMERIC_CODES,
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_NUMERIC_CODES,
  RESOURCE_NOT_FOUND_CODE,
  ASSET_UNAVAILABLE_CODE,
} from "./error-codes.js";

describe("单一码表（IKDZGM / ADR-0083）", () => {
  it("每个生成域字符串码都有对应数字码且已登记文案", () => {
    for (const [stringCode, numeric] of Object.entries(GENERATION_ERROR_NUMERIC_CODES)) {
      const msg = ERROR_CODES[numeric];
      expect(msg, `${stringCode}(=${numeric}) 应有文案`).toBeTruthy();
    }
  });

  it("每个账号域字符串码都有对应数字码且已登记文案", () => {
    for (const [stringCode, numeric] of Object.entries(ACCOUNT_ERROR_NUMERIC_CODES)) {
      const msg = ERROR_CODES[numeric];
      expect(msg, `${stringCode}(=${numeric}) 应有文案`).toBeTruthy();
    }
  });

  it("一码一文案：同一数字码不重复 key", () => {
    // plain 对象天然唯一 key；此处验证关键码值为预期（防漂移）。
    expect(ERROR_CODES[1001]).toBe("账户余额不足，请充值后重试"); // quota_exhausted
    expect(ERROR_CODES[1002]).toBe("输入参数无效"); // invalid_input
  });

  it("生成域关键码与 generation 表数值码一致（唯一 Source of Truth）", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    // 码表里对应数字已有文案
    expect(ERROR_CODES[1001]).toBe(ERROR_CODES[GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]]);
  });

  it("全局业务码已登记；未知码 messageOf 给缺省文案", () => {
    expect(ERROR_CODES[RESOURCE_NOT_FOUND_CODE]).toBe("资源不存在");
    expect(ERROR_CODES[ASSET_UNAVAILABLE_CODE]).toBe("资源不可用");
    expect(errorMessage(999999)).toBeUndefined();
    expect(messageOf(999999)).toBe("未知错误");
  });
});
