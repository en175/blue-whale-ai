import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listUserTopUps: vi.fn(),
  resolveTokenIdentity: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    listUserTopUps: mocks.listUserTopUps,
    resolveTokenIdentity: mocks.resolveTokenIdentity,
  }),
  NewApiError: class NewApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { GET } from "./route";

function getRequest(query = "") {
  return new Request(`http://localhost/api/account/topups${query}`, {
    headers: { authorization: "Bearer sk-test" },
  });
}

/**
 * 鉴权适配 ADR-0062 #18：topup/self 挂账户层，凭用户 sk- 令牌直调，
 * root 凭证在充值链路退役，不再 stub NEW_API_ROOT_*。
 */
describe("GET /api/account/topups（充值记录）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEW_API_BASE_URL", "http://new-api.test");
    // sk- 令牌真校验（Go identity）：缺省放行「sk-test」
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 1,
      username: "user1",
      email: null,
      status: 1,
    });
    mocks.listUserTopUps.mockResolvedValue({
      items: [
        {
          trade_no: "BWP1",
          status: "success",
          amount: 10, // N → 到账 quota = 10 × 500000 → 50 积分
          money: 8.5,
          create_time: 1_750_000_000,
          complete_time: 1_750_000_010,
          payment_method: "bluewhalepay",
        },
        {
          trade_no: "BWP2",
          status: "pending",
          amount: 60,
          money: 51,
          create_time: 1_749_000_000,
          complete_time: 0,
          payment_method: "wechat",
        },
        {
          trade_no: "BWP3",
          status: "expired",
          amount: 5,
          money: 5,
          create_time: 1_748_000_000,
          complete_time: 0,
          payment_method: "alipay",
        },
      ],
      total: 3,
    });
  });

  it("Go 记录 → 展示契约（积分/实付/支付方式文案/三态）", async () => {
    const response = await GET(getRequest());
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.code).toBe(200);
    expect(json.data.total).toBe(3);
    expect(json.data.items).toEqual([
      {
        trade_no: "BWP1",
        credits: 50,
        amount_cny: 8.5,
        payment_method: "扫码支付",
        status: "success",
        created_at: 1_750_000_000,
      },
      {
        trade_no: "BWP2",
        credits: 300,
        amount_cny: 51,
        payment_method: "微信",
        status: "pending",
        created_at: 1_749_000_000,
      },
      {
        trade_no: "BWP3",
        credits: 25,
        amount_cny: 5,
        payment_method: "支付宝",
        status: "failed",
        created_at: 1_748_000_000,
      },
    ]);
  });

  it("用户 sk- 令牌 + 分页参数透传；非法分页回落默认", async () => {
    await GET(getRequest("?p=2&page_size=30"));
    expect(mocks.listUserTopUps).toHaveBeenCalledWith("sk-test", {
      page: 2,
      pageSize: 30,
    });

    await GET(getRequest("?p=abc&page_size=9999"));
    expect(mocks.listUserTopUps).toHaveBeenLastCalledWith("sk-test", {
      page: 1,
      pageSize: 100,
    });
  });

  it("无令牌 → 401；NEW_API_BASE_URL 未配置 → 503", async () => {
    const unauthorized = await GET(
      new Request("http://localhost/api/account/topups"),
    );
    expect(unauthorized.status).toBe(401);

    vi.stubEnv("NEW_API_BASE_URL", "");
    const unavailable = await GET(getRequest());
    expect(unavailable.status).toBe(503);
  });

  it("Go 查询失败 → 502 信封", async () => {
    mocks.listUserTopUps.mockRejectedValue(new Error("boom"));
    const response = await GET(getRequest());
    expect(response.status).toBe(502);
    const json = await response.json();
    expect(json.code).toBe(502);
  });
});
