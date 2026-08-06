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
  listAdminUsers: vi.fn(),
}));

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: mocks.withAdminUser,
}));

vi.mock("@/lib/admin/deps", () => ({
  createAdminDeps: () => ({
    client: { listAdminUsers: mocks.listAdminUsers },
  }),
}));

import { GET } from "./route";

const RAW_USER = {
  id: 42,
  username: "alice",
  display_name: "爱丽丝",
  email: "a@example.com",
  role: 1,
  status: 1,
  quota: 1000,
  used_quota: 200,
  created_at: 1700000000,
};

function authRequest(url: string): Request {
  return new Request(url, { headers: { Authorization: "Bearer sk-admin" } });
}

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAdminUsers.mockResolvedValue({
      items: [RAW_USER],
      total: 1,
      page: 1,
      page_size: 20,
    });
  });

  it("maps new-api users to AdminUser contract fields", async () => {
    const res = await GET(
      authRequest("http://localhost/api/admin/users?keyword=ali"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      list: [
        {
          userId: 42,
          nickname: "爱丽丝",
          phone: "a@example.com",
          balance: 1000,
          totalRecharge: 1200,
          totalSpend: 200,
          role: 1,
          status: "active",
          createdAt: "2023-11-14T22:13:20.000Z",
          updatedAt: "2023-11-14T22:13:20.000Z",
        },
      ],
      total: 1,
    });
  });

  it("falls back to username when display_name is empty and maps disabled status", async () => {
    mocks.listAdminUsers.mockResolvedValue({
      items: [{ ...RAW_USER, display_name: "", status: 0 }],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const res = await GET(authRequest("http://localhost/api/admin/users"));
    const body = await res.json();
    expect(body.data.list[0].nickname).toBe("alice");
    expect(body.data.list[0].status).toBe("disabled");
  });

  it("translates status filter to new-api 1/0 and passes page params", async () => {
    await GET(
      authRequest(
        "http://localhost/api/admin/users?keyword=ali&status=disabled&role=1&page=2&pageSize=5",
      ),
    );
    expect(mocks.listAdminUsers).toHaveBeenCalledWith("sk-admin", 1, {
      keyword: "ali",
      status: 0,
      role: 1,
      page: 2,
      pageSize: 5,
    });
    await GET(authRequest("http://localhost/api/admin/users?status=active"));
    expect(mocks.listAdminUsers).toHaveBeenLastCalledWith(
      "sk-admin",
      1,
      expect.objectContaining({ status: 1 }),
    );
  });

  it("caps pageSize at 100 and defaults invalid page numbers", async () => {
    await GET(
      authRequest("http://localhost/api/admin/users?page=abc&pageSize=999"),
    );
    expect(mocks.listAdminUsers).toHaveBeenLastCalledWith(
      "sk-admin",
      1,
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );
  });

  it("surfaces upstream failures as admin error envelope", async () => {
    mocks.listAdminUsers.mockRejectedValue(
      new NewApiError("账户服务响应异常", 502),
    );
    const res = await GET(authRequest("http://localhost/api/admin/users"));
    expect(res.status).toBe(502);
    expect((await res.json()).success).toBe(false);
  });
});
