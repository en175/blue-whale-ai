import { beforeEach, describe, expect, it, vi } from "vitest";

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
  listAdminTopUps: vi.fn(),
}));

vi.mock("@/lib/auth/product-route-auth", () => ({
  withAdminUser: mocks.withAdminUser,
}));

vi.mock("@/lib/admin/deps", () => ({
  createAdminDeps: () => ({
    client: { listAdminTopUps: mocks.listAdminTopUps },
  }),
}));

import { GET } from "./route";

const RAW_TOPUP = {
  id: 9,
  user_id: 42,
  amount: 6000,
  money: 60,
  trade_no: "BWP20260727001",
  payment_method: "bluewhalepay",
  payment_provider: "bluewhalepay",
  create_time: 1700000000,
  complete_time: 1700003600,
  status: "success",
};

function authRequest(url: string): Request {
  return new Request(url, { headers: { Authorization: "Bearer sk-admin" } });
}

describe("GET /api/admin/orders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAdminTopUps.mockResolvedValue({
      items: [RAW_TOPUP],
      total: 1,
      page: 1,
      page_size: 20,
    });
  });

  it("maps new-api topups to AdminOrder contract fields", async () => {
    const res = await GET(authRequest("http://localhost/api/admin/orders"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      list: [
        {
          tradeNo: "BWP20260727001",
          userId: 42,
          nickname: "",
          phone: "",
          tierName: "6000 积分",
          amount: 6000,
          price: 60,
          points: 6000,
          bonus: 0,
          status: "success",
          paymentMethod: "bluewhalepay",
          platformRefNo: "bluewhalepay",
          ip: "",
          createdAt: "2023-11-14T22:13:20.000Z",
          paidAt: "2023-11-14T23:13:20.000Z",
          arrivedAt: "2023-11-14T23:13:20.000Z",
        },
      ],
      total: 1,
    });
  });

  it("filters by status in web layer and passes keyword/page params upstream", async () => {
    mocks.listAdminTopUps.mockResolvedValue({
      items: [
        RAW_TOPUP,
        { ...RAW_TOPUP, trade_no: "BWP0002", status: "pending" },
      ],
      total: 2,
      page: 1,
      page_size: 20,
    });
    const res = await GET(
      authRequest("http://localhost/api/admin/orders?keyword=BWP&status=pending&page=2&pageSize=10"),
    );
    const body = await res.json();
    expect(mocks.listAdminTopUps).toHaveBeenCalledWith("sk-admin", {
      keyword: "BWP",
      page: 2,
      pageSize: 10,
    });
    expect(body.data.list).toHaveLength(1);
    expect(body.data.list[0].status).toBe("pending");
  });

  it("maps incomplete orders with null paidAt", async () => {
    mocks.listAdminTopUps.mockResolvedValue({
      items: [{ ...RAW_TOPUP, complete_time: 0, status: "pending" }],
      total: 1,
      page: 1,
      page_size: 20,
    });
    const res = await GET(authRequest("http://localhost/api/admin/orders"));
    const body = await res.json();
    expect(body.data.list[0].paidAt).toBeNull();
    expect(body.data.list[0].arrivedAt).toBeNull();
  });
});
