import { describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  createVerificationCode: vi.fn(),
  invalidateOtherCodes: vi.fn(),
  consumeCode: vi.fn(),
  findActiveCode: vi.fn(),
  incrementAttempts: vi.fn(),
}));

const sms = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@lib/shared/persistence/index.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthRepo: () => repo,
}));

vi.mock("./sms.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveSmsProvider: () => sms,
}));

import {
  CodeAttemptsExhaustedError,
  CodeExpiredError,
  CodeWrongError,
  InvalidPhoneError,
  InvalidPurposeError,
  normalizeVerificationInput,
  PhoneVerificationService,
} from "./phone-verification.service.js";

function service() {
  return new PhoneVerificationService({ client: {} } as never);
}

function resetRepo() {
  repo.createVerificationCode.mockReset().mockResolvedValue({ id: "9" });
  repo.invalidateOtherCodes.mockReset().mockResolvedValue(0);
  repo.consumeCode.mockReset().mockResolvedValue(true);
  repo.findActiveCode.mockReset();
  repo.incrementAttempts.mockReset();
  sms.send.mockReset().mockResolvedValue(undefined);
}

describe("normalizeVerificationInput", () => {
  it("合法手机号与用途原样返回", () => {
    expect(
      normalizeVerificationInput({ phone: " 13800001234 ", purpose: "bind" }),
    ).toEqual({ phone: "13800001234", purpose: "bind" });
  });

  it("未传用途按 legacy 处理", () => {
    expect(
      normalizeVerificationInput({ phone: "13800001234", purpose: undefined }),
    ).toEqual({ phone: "13800001234", purpose: "legacy" });
  });

  it("手机号非法抛 InvalidPhoneError", () => {
    expect(() =>
      normalizeVerificationInput({ phone: "12345", purpose: "login" }),
    ).toThrow(InvalidPhoneError);
  });

  it("用途不在白名单抛 InvalidPurposeError", () => {
    expect(() =>
      normalizeVerificationInput({ phone: "13800001234", purpose: "forgot" }),
    ).toThrow(InvalidPurposeError);
  });
});

describe("PhoneVerificationService.issue", () => {
  it("按号码 + 用途创建并发送，随后失效同用途旧码", async () => {
    resetRepo();
    await service().issue({
      phone: "13800001234",
      purpose: "bind",
      ip: "1.2.3.4",
    });
    expect(repo.createVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "13800001234", purpose: "bind" }),
    );
    expect(sms.send).toHaveBeenCalledWith("13800001234", expect.any(String));
    expect(repo.invalidateOtherCodes).toHaveBeenCalledWith(
      "13800001234",
      "bind",
      "9",
    );
  });

  it("短信发送失败时消费新码并抛出", async () => {
    resetRepo();
    sms.send.mockRejectedValue(new Error("sms down"));
    await expect(
      service().issue({ phone: "13800001234", purpose: "login", ip: "1.2.3.4" }),
    ).rejects.toThrow("sms down");
    expect(repo.consumeCode).toHaveBeenCalledWith("9");
    expect(repo.invalidateOtherCodes).not.toHaveBeenCalled();
  });
});

describe("PhoneVerificationService.verify / consume", () => {
  it("没有可用码 → CodeExpiredError", async () => {
    resetRepo();
    repo.findActiveCode.mockResolvedValue(null);
    await expect(
      service().verify({ phone: "1", code: "123456", purposes: ["login"] }),
    ).rejects.toThrow(CodeExpiredError);
  });

  it("码不正确 → 计数并返回剩余次数", async () => {
    resetRepo();
    repo.findActiveCode.mockResolvedValue({ id: "9", code: "123456" });
    repo.incrementAttempts.mockResolvedValue(1);
    await expect(
      service().verify({ phone: "1", code: "000000", purposes: ["login"] }),
    ).rejects.toMatchObject({ name: "CodeWrongError", remaining: 4 });
    expect(repo.consumeCode).not.toHaveBeenCalled();
  });

  it("第 5 次错误 → 消费该码并抛尝试耗尽", async () => {
    resetRepo();
    repo.findActiveCode.mockResolvedValue({ id: "9", code: "123456" });
    repo.incrementAttempts.mockResolvedValue(5);
    await expect(
      service().verify({ phone: "1", code: "000000", purposes: ["login"] }),
    ).rejects.toThrow(CodeAttemptsExhaustedError);
    expect(repo.consumeCode).toHaveBeenCalledWith("9");
  });

  it("码正确 → 返回可消费句柄，消费成功即通过", async () => {
    resetRepo();
    repo.findActiveCode.mockResolvedValue({ id: "9", code: "123456" });
    const verified = await service().verify({
      phone: "1",
      code: "123456",
      purposes: ["login", "legacy"],
    });
    expect(verified).toEqual({ codeId: "9" });
    await service().consume(verified);
    expect(repo.consumeCode).toHaveBeenCalledWith("9");
  });

  it("消费失败（已被并发用掉）→ CodeExpiredError", async () => {
    resetRepo();
    repo.consumeCode.mockResolvedValue(false);
    await expect(service().consume({ codeId: "9" })).rejects.toThrow(
      CodeExpiredError,
    );
  });

  it("第 4 次错误 → 仍返回 CodeWrongError(1)", async () => {
    resetRepo();
    repo.findActiveCode.mockResolvedValue({ id: "9", code: "123456" });
    repo.incrementAttempts.mockResolvedValue(4);
    await expect(
      service().verify({ phone: "1", code: "000000", purposes: ["login"] }),
    ).rejects.toEqual(new CodeWrongError(1));
  });
});
