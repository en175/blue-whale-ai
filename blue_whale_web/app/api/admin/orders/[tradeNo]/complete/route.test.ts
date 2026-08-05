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
  completeAdminTopUp: vi.fn(),
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: mocks.withAdminUser,
}));

vi.mock("@/lib/admin/deps", () => ({
  createAdminDeps: () => ({
    client: { completeAdminTopUp: mocks.completeAdminTopUp },
  }),
}));

vi.mock("@/lib/admin/operation-log", () => ({
  recordAdminAction: mocks.recordAdminAction,
}));

import { POST } from "./route";

function post(
  tradeNo: string,
  body: unknown,
): [Request, { params: Promise<{ tradeNo: string }> }] {
  return [
    new Request(`http://localhost/api/admin/orders/${tradeNo}/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Bearer sk-admin",
        "x-forwarded-for": "1.2.3.4",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tradeNo }) },
  ];
}

describe("POST /api/admin/orders/:tradeNo/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.completeAdminTopUp.mockResolvedValue(undefined);
  });

  it("completes topup upstream and records order audit", async () => {
    const res = await POST(...post("BWP123", { reason: "已线下收款" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: null });
    expect(mocks.completeAdminTopUp).toHaveBeenCalledWith(
      "sk-admin",
      1,
      "BWP123",
    );
    expect(mocks.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "order",
        action: "order.complete",
        target: "BWP123",
        operator: "admin",
        operatorId: "1",
        ipAddress: "1.2.3.4",
      }),
    );
  });

  it("missing reason / empty tradeNo → 400 without upstream call", async () => {
    expect((await POST(...post("BWP123", {}))).status).toBe(400);
    expect((await POST(...post("", { reason: "x" }))).status).toBe(400);
    expect(mocks.completeAdminTopUp).not.toHaveBeenCalled();
  });

  it("upstream failure → error envelope without audit", async () => {
    mocks.completeAdminTopUp.mockRejectedValue(
      new NewApiError("订单不存在", 400),
    );
    const res = await POST(...post("BWP123", { reason: "x" }));
    expect(res.status).toBe(400);
    expect(mocks.recordAdminAction).not.toHaveBeenCalled();
  });
});
