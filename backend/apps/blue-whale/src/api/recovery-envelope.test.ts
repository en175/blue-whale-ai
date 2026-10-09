import { describe, expect, it } from "vitest";

import { RECOVERY_HTTP_STATUSES } from "@lib/contracts";

import { isRecoveryControlledEnvelope } from "./recovery-envelope.js";

describe("isRecoveryControlledEnvelope（IKJKUA 收敛后唯一判定实现）", () => {
  it("code 在默认受控集合并 data.reason 为字符串 → true", () => {
    expect(
      isRecoveryControlledEnvelope({ code: 409, data: { reason: "canvas_binding_conflict" } }),
    ).toBe(true);
  });

  it("code 不在默认集合（如 418、200）→ false", () => {
    expect(
      isRecoveryControlledEnvelope({ code: 418, data: { reason: "x" } }),
    ).toBe(false);
    expect(
      isRecoveryControlledEnvelope({ code: 200, data: { reason: "x" } }),
    ).toBe(false);
  });

  it("data 为 null / reason 非字符串 → false（稳定 reason 是判定的一半）", () => {
    expect(isRecoveryControlledEnvelope({ code: 409, data: null })).toBe(false);
    expect(isRecoveryControlledEnvelope({ code: 409, data: { reason: 42 } })).toBe(false);
    expect(isRecoveryControlledEnvelope({ code: 409, data: {} })).toBe(false);
  });

  it("传入自定义集合时按传入集合判定（canvases 白名单接线的参数语义）", () => {
    const whitelist = new Set([418]);
    expect(
      isRecoveryControlledEnvelope({ code: 418, data: { reason: "x" } }, whitelist),
    ).toBe(true);
    expect(
      isRecoveryControlledEnvelope({ code: 400, data: { reason: "x" } }, whitelist),
    ).toBe(false);
  });

  it("默认集合即恢复契约 RECOVERY_HTTP_STATUSES（不在此文件维护第二份码表）", () => {
    for (const code of RECOVERY_HTTP_STATUSES) {
      expect(
        isRecoveryControlledEnvelope({ code, data: { reason: "stable_reason" } }),
      ).toBe(true);
    }
  });
});
