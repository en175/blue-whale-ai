import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestTopUpAmount: vi.fn(),
  createBlueWhalePayTopUp: vi.fn(),
  resolveTokenIdentity: vi.fn(),
  getById: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    requestTopUpAmount: mocks.requestTopUpAmount,
    createBlueWhalePayTopUp: mocks.createBlueWhalePayTopUp,
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

vi.mock("@/lib/topup-tier/deps", () => ({
  createTopupTierDeps: () => ({ db: { getById: mocks.getById } }),
}));

import { NewApiError } from "@blue-whale/core";

import { POST } from "./route";

function postOrder(body: unknown, token = "sk-test") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/recharge/order", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const ACTIVE_TIER = {
  id: "1",
  name: "100元档",
  amount: 50_000_000, // 到账积分 = 原价 × QuotaPerUnit(500000)
  originalPrice: 100, // 美元额度 N
  discount: 0.85,
  price: 85,
  isRecommended: false,
  status: "active" as const,
  startTime: null,
  endTime: null,
  sortOrder: 1,
  createdAt: "",
  updatedAt: "",
};

describe("POST /api/recharge/order（原生充值改接）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("NEW_API_BASE_URL", "http://new-api.test");
    // sk- 令牌真校验（Go identity）：缺省放行「sk-test」
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 1,
      username: "root",
      email: null,
      status: 1,
    });
    mocks.getById.mockResolvedValue(ACTIVE_TIER);
    mocks.requestTopUpAmount.mockResolvedValue(85);
    mocks.createBlueWhalePayTopUp.mockResolvedValue({
      tradeNo: "BWP1xyz",
      payData: "https://pay.test/qr/BWP1",
    });
  });

  it("解析 web 档位 → 报价 → 原生下单（当前请求的用户 Token），返回前端契约壳", async () => {
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }),
    );

    // 报价与下单都用当前请求的 sk- 令牌 + 美元额度 N=100；wechat → WX_NATIVE；
    // 不带任何 userId 参数（订单 User ID 由 Go 从 Token 属主解析）
    expect(mocks.requestTopUpAmount).toHaveBeenCalledWith("sk-test", 100);
    expect(mocks.createBlueWhalePayTopUp).toHaveBeenCalledWith(
      "sk-test",
      100,
      "WX_NATIVE",
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.code).toBe(200);
    expect(json.data).toMatchObject({
      trade_no: "BWP1xyz",
      qr_code_url: "https://pay.test/qr/BWP1",
      amount: 85, // 实付 = Go 报价
      points: 50_000_000, // 到账积分 = tier.amount
    });
    expect(typeof json.data.expire_time).toBe("string");
  });

  it("alipay 映射到 ALI_QR", async () => {
    await POST(postOrder({ tier_id: "1", payment_method: "alipay" }));
    expect(mocks.createBlueWhalePayTopUp).toHaveBeenCalledWith(
      "sk-test",
      100,
      "ALI_QR",
    );
  });

  it("缺少 NEW_API_BASE_URL → 503，且不下单", async () => {
    vi.stubEnv("NEW_API_BASE_URL", "");
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 503 });
    expect(mocks.createBlueWhalePayTopUp).not.toHaveBeenCalled();
  });

  it("档位不存在 → 404，且不下单", async () => {
    mocks.getById.mockResolvedValue(null);
    const response = await POST(
      postOrder({ tier_id: "999", payment_method: "wechat" }),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: 404,
      msg: "档位不存在",
    });
    expect(mocks.createBlueWhalePayTopUp).not.toHaveBeenCalled();
  });

  it("档位已下架 → 400", async () => {
    mocks.getById.mockResolvedValue({ ...ACTIVE_TIER, status: "inactive" });
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ msg: "该档位已下架" });
  });

  it("非法支付方式 → 400，且不查档位", async () => {
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "paypal" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      msg: "支付方式仅支持 wechat / alipay",
    });
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("缺少 sk- token → 401", async () => {
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }, ""),
    );
    expect(response.status).toBe(401);
  });
});

// 前端令牌必须过真校验（Go identity），伪造字符串不得到达下单链路。
describe("POST /api/recharge/order 令牌门禁（Go identity 真校验）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEW_API_BASE_URL", "http://new-api.test");
    mocks.getById.mockResolvedValue(ACTIVE_TIER);
    mocks.requestTopUpAmount.mockResolvedValue(85);
    mocks.createBlueWhalePayTopUp.mockResolvedValue({
      tradeNo: "BWP1xyz",
      payData: "https://pay.test/qr/BWP1",
    });
  });

  it("伪造令牌（Go 判 401）→ 401，且不下单", async () => {
    mocks.resolveTokenIdentity.mockRejectedValue(
      new NewApiError("invalid token", 401),
    );
    const response = await POST(
      // 用独立令牌串避开 identity 缓存（"sk-test" 在上组已缓存为有效）
      postOrder({ tier_id: "1", payment_method: "wechat" }, "sk-forged"),
    );
    expect(response.status).toBe(401);
    expect(mocks.createBlueWhalePayTopUp).not.toHaveBeenCalled();
    expect(mocks.getById).not.toHaveBeenCalled();
  });

  it("账户已停用（identity status ≠ 1）→ 403，且不下单", async () => {
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 2,
      username: "banned",
      email: null,
      status: 2,
    });
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }, "sk-banned"),
    );
    expect(response.status).toBe(403);
    expect(mocks.createBlueWhalePayTopUp).not.toHaveBeenCalled();
  });

  it("Go identity 服务异常 → 502，不放行下单", async () => {
    mocks.resolveTokenIdentity.mockRejectedValue(new Error("network down"));
    const response = await POST(
      postOrder({ tier_id: "1", payment_method: "wechat" }, "sk-err"),
    );
    expect(response.status).toBe(502);
    expect(mocks.createBlueWhalePayTopUp).not.toHaveBeenCalled();
  });
});
