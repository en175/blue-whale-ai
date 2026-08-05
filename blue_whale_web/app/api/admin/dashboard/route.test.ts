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
    ) => handler({ userId: "1", status: "enabled", isAdmin: true, username: "admin" }),
  ),
  collectDashboardStats: vi.fn(),
}));

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: mocks.withAdminUser,
}));

vi.mock("@/lib/admin/dashboard", () => ({
  collectDashboardStats: mocks.collectDashboardStats,
}));

vi.mock("@/lib/admin/deps", () => ({
  createAdminDeps: () => ({ client: {} }),
}));

import { GET } from "./route";

describe("GET /api/admin/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collectDashboardStats.mockResolvedValue({
      totalUsers: 10,
      todayRecharge: 100,
      todayRechargeCount: 2,
      todaySpend: 30,
      pendingOrders: 1,
      recentRecharges: [],
      recentConsumes: [],
    });
  });

  it("returns collected stats and passes the admin token through", async () => {
    const res = await GET(
      new Request("http://localhost/api/admin/dashboard", {
        headers: { Authorization: "Bearer sk-admin" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalUsers).toBe(10);
    expect(mocks.collectDashboardStats).toHaveBeenCalledWith(
      expect.anything(),
      "sk-admin",
    );
  });

  it("surfaces collection failures as admin error envelope", async () => {
    mocks.collectDashboardStats.mockRejectedValue(
      new NewApiError("账户服务响应异常", 502),
    );
    const res = await GET(
      new Request("http://localhost/api/admin/dashboard", {
        headers: { Authorization: "Bearer sk-admin" },
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });
});
