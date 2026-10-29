import { describe, expect, it } from "vitest";

import {
  ERROR_CODES,
  errorMessage,
  messageOf,
  ERROR_QUOTA_EXHAUSTED,
  ERROR_INVALID_INPUT,
  GENERATION_ERROR_NUMERIC_CODES,
  ERROR_CAPABILITY_UNSUPPORTED_PARAM,
  ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION,
  ERROR_CAPABILITY_UNSUPPORTED_RATIO,
  ERROR_CAPABILITY_UNSUPPORTED_DURATION,
  ERROR_INVALID_REFERENCE,
  ERROR_CONTENT_REJECTED_REFERENCE,
  ERROR_CONTENT_REJECTED_AUDIO,
  ERROR_JOB_NOT_RETRYABLE_STATUS,
  ERROR_JOB_ALREADY_RETRIED,
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
    expect(ERROR_CODES[1001]).toBe("积分余额不足，本次尚未提交。");
    expect(ERROR_CODES[1002]).toBe("当前参数不受支持，请调整后再发送。");
  });

  it("生成域关键码与 generation 表数值码一致（唯一 Source of Truth）", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]).toBe(1001);
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_INPUT]).toBe(1002);
    expect(ERROR_CODES[1001]).toBe(ERROR_CODES[GENERATION_ERROR_NUMERIC_CODES[ERROR_QUOTA_EXHAUSTED]]);
  });

  it("IKE7JP：capability_unsupported_param 登记数值码 1030 且一码一文案", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CAPABILITY_UNSUPPORTED_PARAM]).toBe(1030);
    expect(ERROR_CODES[1030]).toBe("当前参数不受支持，请调整后再发送。");
    expect(1030).toBeGreaterThanOrEqual(1000);
    expect(1030).toBeLessThanOrEqual(1099);
  });

  it("IKE7JP：能力细分码 1031-1033 各配固定文案（一码一文案）", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CAPABILITY_UNSUPPORTED_RESOLUTION]).toBe(1031);
    expect(ERROR_CODES[1031]).toBe("当前参数不受支持，请调整后再发送。");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CAPABILITY_UNSUPPORTED_RATIO]).toBe(1032);
    expect(ERROR_CODES[1032]).toBe("当前参数不受支持，请调整后再发送。");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CAPABILITY_UNSUPPORTED_DURATION]).toBe(1033);
    expect(ERROR_CODES[1033]).toBe("当前参数不受支持，请调整后再发送。");
  });

  it("IKE7JP：invalid_reference 登记数值码 1034 且一码一文案", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_INVALID_REFERENCE]).toBe(1034);
    expect(ERROR_CODES[1034]).toBe("参考素材无法用于本次生成，请更换后再发送。");
  });

  it("IKFL53/IKJ8J8：content_rejected_reference 登记数值码 1038，文案为中性兜底", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CONTENT_REJECTED_REFERENCE]).toBe(1038);
    expect(ERROR_CODES[1038]).toBe("内容未通过审核，请调整描述或参考素材后再发送。");
    expect(1038).toBeGreaterThanOrEqual(1000);
    expect(1038).toBeLessThanOrEqual(1099);
  });

  it("IKJ8J8：content_rejected_audio 登记数值码 1059 且一码一文案", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_CONTENT_REJECTED_AUDIO]).toBe(1059);
    expect(ERROR_CODES[1059]).toBe("内容未通过审核，请调整描述或参考素材后再发送。");
    expect(1059).toBeGreaterThanOrEqual(1000);
    expect(1059).toBeLessThanOrEqual(1099);
  });

  it("IKIPWU：重试不可重试两类专用码 1054/1055 且一码一文案", () => {
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_JOB_NOT_RETRYABLE_STATUS]).toBe(1054);
    expect(ERROR_CODES[1054]).toBe("当前状态不允许重试，仅失败或部分成功的任务可重试");
    expect(GENERATION_ERROR_NUMERIC_CODES[ERROR_JOB_ALREADY_RETRIED]).toBe(1055);
    expect(ERROR_CODES[1055]).toBe("该任务的失败项已全部重试，无需再次重试");
    expect(1054).toBeGreaterThanOrEqual(1000);
    expect(1054).toBeLessThanOrEqual(1099);
    expect(1055).toBeGreaterThanOrEqual(1000);
    expect(1055).toBeLessThanOrEqual(1099);
  });

  it("全局业务码已登记；未知码 messageOf 给缺省文案", () => {
    expect(ERROR_CODES[RESOURCE_NOT_FOUND_CODE]).toBe("资源不存在");
    expect(ERROR_CODES[ASSET_UNAVAILABLE_CODE]).toBe("资源不可用");
    expect(errorMessage(999999)).toBeUndefined();
    expect(messageOf(999999)).toBe("未知错误");
  });
});
