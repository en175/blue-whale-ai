import { beforeEach, describe, expect, it, vi } from "vitest";

import { NewApiError } from "@blue-whale/core";

const mocks = vi.hoisted(() => ({
  withAdminUser: vi.fn(
    (
      _request: Request,
      handler: (auth: {
        userId: string;
        status: string;
        isAdmin: boolean;
        username: string;
      }) => Promise<Response>,
    ) =>
      handler({
        userId: "1",
        status: "enabled",
        isAdmin: true,
        username: "admin",
      }),
  ),
  manageAdminUser: vi.fn(),
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: mocks.withAdminUser,
}));

vi.mock("@/lib/admin/deps", () => ({
  createAdminDeps: () => ({
    client: { manageAdminUser: mocks.manageAdminUser },
  }),
}));

vi.mock("@/lib/admin/operation-log", () => ({
  recordAdminAction: mocks.recordAdminAction,
}));

import { POST } from "./route";

function post(
  userId: string,
  body: unknown,
): [Request, { params: Promise<{ userId: string }> }] {
  return [
    new Request(`http://localhost/api/admin/users/${userId}/manage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer sk-admin",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ userId }) },
  ];
}

describe("POST /api/admin/users/:userId/manage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.manageAdminUser.mockResolvedValue(undefined);
  });

  it("freeze → new-api disable + user audit log", async () => {
    const res = await POST(...post("42", { action: "freeze", reason: "违规" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: null });
    expect(mocks.manageAdminUser).toHaveBeenCalledWith("sk-admin", 1, {
      id: 42,
      action: "disable",
    });
    expect(mocks.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "user",
        action: "user.freeze",
        target: "user:42",
        targetUserId: "42",
        operator: "admin",
        operatorId: "1",
        ipAddress: "1.2.3.4",
      }),
    );
  });

  it("unfreeze → new-api enable", async () => {
    await POST(...post("42", { action: "unfreeze", reason: "申诉通过" }));
    expect(mocks.manageAdminUser).toHaveBeenCalledWith("sk-admin", 1, {
      id: 42,
      action: "enable",
    });
    expect(mocks.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.unfreeze" }),
    );
  });

  it("adjustBalance positive → add_quota add with abs value", async () => {
    await POST(
      ...post("42", { action: "adjustBalance", value: 500, reason: "补偿" }),
    );
    expect(mocks.manageAdminUser).toHaveBeenCalledWith("sk-admin", 1, {
      id: 42,
      action: "add_quota",
      value: 500,
      mode: "add",
    });
    expect(mocks.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.adjust_balance",
        detail: expect.stringContaining('"value":500'),
      }),
    );
  });

  it("adjustBalance negative → add_quota subtract", async () => {
    await POST(
      ...post("42", { action: "adjustBalance", value: -50, reason: "扣回" }),
    );
    expect(mocks.manageAdminUser).toHaveBeenCalledWith("sk-admin", 1, {
      id: 42,
      action: "add_quota",
      value: 50,
      mode: "subtract",
    });
  });

  it("adjustBalance with zero value → 400, no upstream call", async () => {
    const res = await POST(
      ...post("42", { action: "adjustBalance", value: 0, reason: "x" }),
    );
    expect(res.status).toBe(400);
    expect(mocks.manageAdminUser).not.toHaveBeenCalled();
  });

  it("missing reason / invalid action / bad userId → 400", async () => {
    expect((await POST(...post("42", { action: "freeze" }))).status).toBe(400);
    expect(
      (await POST(...post("42", { action: "ban", reason: "x" }))).status,
    ).toBe(400);
    expect(
      (await POST(...post("abc", { action: "freeze", reason: "x" }))).status,
    ).toBe(400);
    expect(mocks.manageAdminUser).not.toHaveBeenCalled();
  });

  it("upstream failure → error envelope without audit", async () => {
    mocks.manageAdminUser.mockRejectedValue(new NewApiError("账户已停用", 403));
    const res = await POST(...post("42", { action: "freeze", reason: "x" }));
    expect(res.status).toBe(403);
    expect(mocks.recordAdminAction).not.toHaveBeenCalled();
  });
});
