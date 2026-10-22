import { describe, expect, it, vi } from "vitest";

import { ACCOUNT_ERROR_INVALID_PURPOSE, FAILURE_CODE, LEGACY_VERIFICATION_PURPOSE } from "@lib/contracts";
import { handleSendCode } from "./handle-send-code.js";

function deps() {
  const createVerificationCode = vi.fn().mockResolvedValue({ id: "9" });
  const invalidateOtherCodes = vi.fn().mockResolvedValue(0);
  const consumeCode = vi.fn().mockResolvedValue(true);
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    db: { createVerificationCode, invalidateOtherCodes, consumeCode },
    sms: { send },
    createVerificationCode,
    send,
  };
}

describe("handleSendCode", () => {
  it("带合法用途：按用途发码", async () => {
    const d = deps();
    const out = await handleSendCode(
      { phone: "13800001234", purpose: "bind", ip: "1.2.3.4" },
      d,
    );
    expect(out).toMatchObject({ code: 200 });
    expect(d.createVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "13800001234", purpose: "bind" }),
    );
  });

  it("未传用途：按过渡用途 legacy 发码（兼容未升级前端，登录与补绑都能用）", async () => {
    const d = deps();
    await handleSendCode({ phone: "13800001234", ip: "1.2.3.4" }, d);
    expect(d.createVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: LEGACY_VERIFICATION_PURPOSE }),
    );
  });

  it("用途不在白名单：拒绝且不发码", async () => {
    const d = deps();
    const out = await handleSendCode(
      { phone: "13800001234", purpose: "forgot-password", ip: "1.2.3.4" },
      d,
    );
    expect(out).toMatchObject({
      code: FAILURE_CODE,
      error_code: ACCOUNT_ERROR_INVALID_PURPOSE,
    });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("手机号格式不对：拒绝且不发码", async () => {
    const d = deps();
    const out = await handleSendCode({ phone: "12345", ip: "1.2.3.4" }, d);
    expect(out).toMatchObject({ code: FAILURE_CODE });
    expect(d.send).not.toHaveBeenCalled();
  });

  it("短信渠道失败：返回失败信封", async () => {
    const d = deps();
    d.send.mockRejectedValue(new Error("sms down"));
    const out = await handleSendCode(
      { phone: "13800001234", purpose: "login", ip: "1.2.3.4" },
      d,
    );
    expect(out).toMatchObject({ code: FAILURE_CODE, msg: "短信发送失败" });
  });
});
