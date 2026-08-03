import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTopUpByTradeNo: vi.fn(),
  getTokenUsage: vi.fn(),
  resolveTokenIdentity: vi.fn(),
}));

vi.mock("@blue-whale/core", () => ({
  createNewApiClient: () => ({
    getTopUpByTradeNo: mocks.getTopUpByTradeNo,
    getTokenUsage: mocks.getTokenUsage,
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

import { NewApiError } from "@blue-whale/core";

import { GET } from "./route";

function getStatus(tradeNo = "BWP1xyz", token = "sk-test") {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(`http://localhost/api/recharge/order/${tradeNo}/status`, {
    method: "GET",
    headers,
  });
}
const params = (tradeNo = "BWP1xyz") => ({
  params: Promise.resolve({ tradeNo }),
});

describe("GET /api/recharge/order/:tradeNo/status（原生查单改接）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEW_API_BASE_URL", "http://new-api.test");
    vi.stubEnv("NEW_API_ROOT_ACCESS_TOKEN", "root-access-token");
    vi.stubEnv("NEW_API_ROOT_USER_ID", "1");
    mocks.resolveTokenIdentity.mockResolvedValue({
      userId: 1,
      username: "root",
      email: null,
      status: 1,
    });
  });

  it("Go success → paid，并取余额作 credits_after", async () => {
    mocks.getTopUpByTradeNo.mockResolvedValue({ status: "success" });
    mocks.getTokenUsage.mockResolvedValue({ userQuota: 55_000_000 });
    const res = await GET(getStatus(), params());
    expect(res.status).toBe(200);
    // 查单用 root 凭证 + New-Api-User（订单以 root 身份创建）
    expect(mocks.getTopUpByTradeNo).toHaveBeenCalledWith(
      "root-access-token",
      "BWP1xyz",
      1,
    );
    expect(await res.json()).toMatchObject({
      code: 200,
      data: { status: "paid", credits_after: 55_000_000 },
    });
  });

  it("Go pending → pending，不查余额", async () => {
    mocks.getTopUpByTradeNo.mockResolvedValue({ status: "pending" });
    const res = await GET(getStatus(), params());
    expect(await res.json()).toMatchObject({
      data: { status: "pending", credits_after: null },
    });
    expect(mocks.getTokenUsage).not.toHaveBeenCalled();
  });

  it("订单不存在 → 404", async () => {
    mocks.getTopUpByTradeNo.mockResolvedValue(null);
    const res = await GET(getStatus(), params());
    expect(res.status).toBe(404);
  });

  it("缺少 sk- token → 401", async () => {
    const res = await GET(getStatus("BWP1xyz", ""), params());
    expect(res.status).toBe(401);
    expect(mocks.getTopUpByTradeNo).not.toHaveBeenCalled();
  });

  it("伪造令牌（Go 判 401）→ 401，不查单", async () => {
    mocks.resolveTokenIdentity.mockRejectedValue(
      new NewApiError("invalid token", 401),
    );
    const res = await GET(getStatus("BWP1xyz", "sk-forged-status"), params());
    expect(res.status).toBe(401);
    expect(mocks.getTopUpByTradeNo).not.toHaveBeenCalled();
  });

  it("Go identity 服务异常 → 502，不放行", async () => {
    mocks.resolveTokenIdentity.mockRejectedValue(new Error("network down"));
    const res = await GET(getStatus("BWP1xyz", "sk-err-status"), params());
    expect(res.status).toBe(502);
    expect(mocks.getTopUpByTradeNo).not.toHaveBeenCalled();
  });

  it("缺少 root 凭证 → 503", async () => {
    vi.stubEnv("NEW_API_ROOT_ACCESS_TOKEN", "");
    const res = await GET(getStatus(), params());
    expect(res.status).toBe(503);
  });
});
