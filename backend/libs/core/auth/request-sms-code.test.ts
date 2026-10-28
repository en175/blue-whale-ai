import { describe, expect, it, vi } from "vitest";

import { requestSmsCode } from "./request-sms-code.js";

describe("requestSmsCode", () => {
  it("生成 6 位码、按用途写 verification_codes、发送成功后作废旧码（code TTL 5min）", async () => {
    const createVerificationCode = vi.fn().mockResolvedValue({ id: "9" });
    const invalidateOtherCodes = vi.fn().mockResolvedValue(1);
    const consumeCode = vi.fn().mockResolvedValue(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const fixedNow = new Date("2026-07-27T12:00:00.000Z");

    const result = await requestSmsCode(
      { phone: "15079999999", purpose: "login", ip: "1.2.3.4" },
      {
        db: { createVerificationCode, invalidateOtherCodes, consumeCode },
        sms: { send },
        generateCode: () => "123456",
        now: () => fixedNow,
      },
    );

    expect(result.code).toBe("123456");
    expect(createVerificationCode).toHaveBeenCalledWith({
      phone: "15079999999",
      purpose: "login",
      code: "123456",
      ip: "1.2.3.4",
      expiresAt: new Date("2026-07-27T12:05:00.000Z"),
    });
    expect(send).toHaveBeenCalledWith("15079999999", "123456");
    expect(invalidateOtherCodes).toHaveBeenCalledWith("15079999999", "login", "9");
    expect(consumeCode).not.toHaveBeenCalled();
  });

  it("发送明确失败时作废本次新码、不动旧码——否则未送达的码会挡住已送达的旧码", async () => {
    const createVerificationCode = vi.fn().mockResolvedValue({ id: "9" });
    const invalidateOtherCodes = vi.fn().mockResolvedValue(0);
    const consumeCode = vi.fn().mockResolvedValue(true);
    const send = vi.fn().mockRejectedValue(new Error("sms down"));

    await expect(
      requestSmsCode(
        { phone: "15079999999", purpose: "login", ip: "1.2.3.4" },
        {
          db: { createVerificationCode, invalidateOtherCodes, consumeCode },
          sms: { send },
          generateCode: () => "123456",
        },
      ),
    ).rejects.toMatchObject({
      name: "SmsSendFailedError",
      failure: expect.objectContaining({ message: "sms down" }),
    });
    expect(consumeCode).toHaveBeenCalledWith("9");
    expect(invalidateOtherCodes).not.toHaveBeenCalled();
  });
});
