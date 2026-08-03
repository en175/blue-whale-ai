import { describe, expect, it, vi } from "vitest";

import {
  AuthenticationError,
  getAuthenticatedUser,
} from "./authenticated-user";
import { withAdminUser, withAuthenticatedUser } from "./product-route-auth";

vi.mock("./authenticated-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./authenticated-user")>();

  return {
    ...actual,
    getAuthenticatedUser: vi.fn(),
  };
});

const request = new Request("http://web.test/api/products", {
  headers: { Authorization: "Bearer sk-private-credential" },
});
const mockedGetAuthenticatedUser = vi.mocked(getAuthenticatedUser);

describe("withAuthenticatedUser", () => {
  it("calls the handler with the authenticated product user", async () => {
    mockedGetAuthenticatedUser.mockResolvedValue({
      userId: "42",
      status: "enabled",
      isAdmin: false,
    });
    const handler = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));

    const response = await withAuthenticatedUser(request, handler);

    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledWith({ userId: "42", status: "enabled", isAdmin: false });
  });

  it.each([
    [401, "登录凭证无效"],
    [403, "账户已停用"],
    [502, "账户服务响应异常"],
    [503, "账户服务暂不可用"],
  ] as const)(
    "maps authentication status %i to the product error envelope",
    async (status, msg) => {
      mockedGetAuthenticatedUser.mockRejectedValue(
        new AuthenticationError(status),
      );

      const response = await withAuthenticatedUser(request, vi.fn());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code: status, msg, data: null });
    },
  );

  it("rethrows unknown authentication resolver errors", async () => {
    const error = new Error("resolver programming error");
    mockedGetAuthenticatedUser.mockRejectedValue(error);

    await expect(withAuthenticatedUser(request, vi.fn())).rejects.toBe(error);
  });

  it("rethrows handler errors", async () => {
    mockedGetAuthenticatedUser.mockResolvedValue({
      userId: "42",
      status: "enabled",
      isAdmin: false,
    });
    const error = new Error("handler programming error");

    await expect(
      withAuthenticatedUser(request, () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("does not expose credentials or their digest in authentication responses", async () => {
    mockedGetAuthenticatedUser.mockRejectedValue(new AuthenticationError(401));

    const response = await withAuthenticatedUser(request, vi.fn());
    const body = await response.text();

    expect(body).not.toContain("sk-private-credential");
    expect(body).not.toMatch(/[a-f0-9]{64}/);
  });
});

describe("withAdminUser", () => {
  it("resolves identity fresh (bypassing the ordinary cache) and calls the handler for admins", async () => {
    mockedGetAuthenticatedUser.mockResolvedValue({
      userId: "9",
      status: "enabled",
      isAdmin: true,
    });
    const handler = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const response = await withAdminUser(request, handler);

    expect(response.status).toBe(204);
    expect(mockedGetAuthenticatedUser).toHaveBeenCalledWith(request, { policy: "fresh" });
    expect(handler).toHaveBeenCalledWith({ userId: "9", status: "enabled", isAdmin: true });
  });

  it("rejects authenticated non-admin accounts with a 403 envelope", async () => {
    mockedGetAuthenticatedUser.mockResolvedValue({
      userId: "42",
      status: "enabled",
      isAdmin: false,
    });
    const handler = vi.fn();

    const response = await withAdminUser(request, handler);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 403, msg: "需要管理员权限", data: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it("maps authentication failures before the admin check", async () => {
    mockedGetAuthenticatedUser.mockRejectedValue(new AuthenticationError(401));

    const response = await withAdminUser(request, vi.fn());

    expect(response.status).toBe(401);
  });
});
