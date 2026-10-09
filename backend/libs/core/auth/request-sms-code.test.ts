import { describe, expect, it, vi } from "vitest";

import { requestSmsCode } from "./request-sms-code.js";

describe("requestSmsCode (happy path)", () => {
  it("生成 6 位码、写 verification_codes、调 SMS 发送（code TTL 5min）", async () => {
    const createVerificationCode = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const fixedNow = new Date("2026-07-27T12:00:00.000Z");

    const result = await requestSmsCode(
      { phone: "15079999999", ip: "1.2.3.4" },
      {
        db: { createVerificationCode },
        sms: { send },
        generateCode: () => "123456",
        now: () => fixedNow,
      },
    );

    expect(result.code).toBe("123456");
    expect(createVerificationCode).toHaveBeenCalledWith({
      phone: "15079999999",
      code: "123456",
      ip: "1.2.3.4",
      expiresAt: new Date("2026-07-27T12:05:00.000Z"),
    });
    expect(send).toHaveBeenCalledWith("15079999999", "123456");
  });
});
