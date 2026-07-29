import { describe, expect, it, vi } from "vitest";

import { handleSendCode } from "./handle-send-code.js";

// send-code 路由处理器：手机号校验 → requestSmsCode → {code,msg,data} 信封。
function makeDeps() {
  return {
    db: { createVerificationCode: vi.fn().mockResolvedValue(undefined) },
    sms: { send: vi.fn().mockResolvedValue(undefined) },
    generateCode: () => "123456",
    now: () => new Date("2026-07-27T12:00:00.000Z"),
  };
}

describe("handleSendCode", () => {
  it("合法手机号 → 200 信封 + 触发 SMS", async () => {
    const deps = makeDeps();
    const result = await handleSendCode({ phone: "15079999999", ip: "1.2.3.4" }, deps);
    expect(result).toEqual({ code: 200, msg: null, data: null });
    expect(deps.sms.send).toHaveBeenCalledWith("15079999999", "123456");
    expect(deps.db.createVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "15079999999", code: "123456", ip: "1.2.3.4" }),
    );
  });

  it("非法手机号 → 400 信封，不发短信", async () => {
    const deps = makeDeps();
    const result = await handleSendCode({ phone: "123", ip: "1.2.3.4" }, deps);
    expect(result.code).toBe(400);
    expect(deps.sms.send).not.toHaveBeenCalled();
  });

  it("SMS 失败 → 400 信封（不抛到外层）", async () => {
    const deps = makeDeps();
    deps.sms.send = vi.fn().mockRejectedValue(new Error("upstream down"));
    const result = await handleSendCode({ phone: "15079999999", ip: "1.2.3.4" }, deps);
    expect(result.code).toBe(400);
  });
});
