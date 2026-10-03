// IKJKUA：受控错误判定收敛后的行为锚——共享判定函数是全部 16 个控制器的唯一判定实现，
// 这里钉死三件事：默认集合语义、自定义集合参数语义（canvases 白名单接线依赖它）、
// data.reason 稳定字符串分支。直写行为（writeRecoveryControlled）无改动、不在此重测。
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
    // 418 不在默认集合、在传入集合 → true（证明第二参数生效，非默认集合兜底）
    expect(
      isRecoveryControlledEnvelope({ code: 418, data: { reason: "x" } }, whitelist),
    ).toBe(true);
    // 400 在默认集合、不在传入集合 → false（证明判定未被默认集合放大）
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
