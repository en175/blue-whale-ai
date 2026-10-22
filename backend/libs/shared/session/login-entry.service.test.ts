import { describe, expect, it, vi } from "vitest";

import type { LocalLoginResult } from "@lib/shared/identity/index.js";
import { LoginEntryService } from "./login-entry.service.js";

function result(over: Partial<LocalLoginResult> = {}): LocalLoginResult {
  return {
    userId: 42,
    username: "alice",
    nickname: "Alice",
    email: "a@example.com",
    phone: "13800001234",
    hasPassword: true,
    mustChangePassword: false,
    role: 1,
    status: 1,
    ...over,
  };
}

function setup() {
  const sessions = {
    issueToken: vi.fn(async () => "jwt-token"),
    createSession: vi.fn(async () => undefined),
    revokeAllForUser: vi.fn(async () => 2),
  };
  const identity = {
    recordLogin: vi.fn(async () => undefined),
  };
  const service = new LoginEntryService(
    sessions as never,
    identity as never,
  );
  return { service, sessions, identity };
}

describe("LoginEntryService", () => {
  it("成功后签发 token、写会话、记录日志并返回统一响应", async () => {
    const { service, sessions, identity } = setup();
    const entry = await service.succeed({
      result: result(),
      isNewUser: true,
      clientId: "client-abcdefgh",
      ip: "1.2.3.4",
      userAgent: "vitest",
    });

    expect(entry.token).toBe("jwt-token");
    expect(sessions.createSession).toHaveBeenCalledWith(
      "jwt-token",
      expect.objectContaining({
        userId: 42,
        username: "alice",
        role: 1,
        status: 1,
        clientId: "client-abcdefgh",
      }),
    );
    expect(entry.data).toEqual({
      token: "jwt-token",
      user_id: 42,
      username: "alice",
      nickname: "Alice",
      email: "a@example.com",
      phone: "13800001234",
      is_new_user: true,
      has_password: true,
      must_change_password: false,
    });
    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "42",
        username: "alice",
        ip: "1.2.3.4",
        userAgent: "vitest",
        success: true,
      }),
    );
  });

  it("要求撤销其它会话时保留新 token", async () => {
    const { service, sessions } = setup();
    await service.succeed({
      result: result(),
      isNewUser: false,
      ip: "1.2.3.4",
      revokeOthers: true,
    });
    expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42, "jwt-token");
  });

  it("身份结果缺 userId 时拒绝签发", async () => {
    const { service, sessions } = setup();
    await expect(
      service.succeed({
        result: result({ userId: null as unknown as number }),
        isNewUser: false,
        ip: "1.2.3.4",
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(sessions.issueToken).not.toHaveBeenCalled();
  });

  it("日志写失败不阻断登录", async () => {
    const { service, identity } = setup();
    identity.recordLogin.mockRejectedValue(new Error("db down"));
    const entry = await service.succeed({
      result: result(),
      isNewUser: false,
      ip: "1.2.3.4",
    });
    expect(entry.token).toBe("jwt-token");
  });

  it("失败审计记录 success=false 与原因", async () => {
    const { service, identity } = setup();
    await service.fail({
      username: "alice",
      ip: "1.2.3.4",
      reason: "账密错误",
    });
    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "alice",
        success: false,
        reason: "账密错误",
      }),
    );
  });

  it("非登录成功审计记录 success=true", async () => {
    const { service, identity } = setup();
    await service.audit({
      userId: "42",
      username: "alice",
      ip: "1.2.3.4",
      reason: "迁移验证",
    });
    expect(identity.recordLogin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "42", success: true, reason: "迁移验证" }),
    );
  });
});
