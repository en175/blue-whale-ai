import { NewApiError } from "@lib/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLLECT_TOKEN_ENV } from "./collect-token.js";
import { RechargeController } from "./recharge.controller.js";

const TIER = {
  id: "tier-1",
  name: "基础套餐",
  amount: 18_500_000,
  originalPrice: 37,
  discount: 0.9,
  price: 33.3,
  isRecommended: false,
  status: "active" as const,
  startTime: null,
  endTime: null,
  sortOrder: 1,
  createdAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
};

function createController() {
  const account = {
    resolveTokenIdentity: vi.fn().mockResolvedValue({
      userId: 42,
      username: "alice",
      email: null,
      status: 1,
      role: 1,
    }),
    createCollectTopUp: vi.fn().mockResolvedValue({
      tradeNo: "BWP9",
      payData: "weixin://pay/qr",
    }),
    requestTopUpAmount: vi.fn(),
    createBlueWhalePayTopUp: vi.fn(),
  };
  const topupTier = {
    getById: vi.fn().mockResolvedValue(TIER),
  };
  const controller = new RechargeController(account as never, topupTier as never);
  return { controller, account, topupTier };
}

describe("RechargeController.order（IKBXLN 代收）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T10:00:00.000Z"));
    process.env[COLLECT_TOKEN_ENV] = "secret-collect";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env[COLLECT_TOKEN_ENV];
  });

  it("没有 Bearer 令牌就 401，不调代收", async () => {
    const { controller, account } = createController();
    await expect(
      controller.order({ tier_id: "tier-1", payment_method: "wechat" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(account.createCollectTopUp).not.toHaveBeenCalled();
  });

  it("未配代收凭证就 503，不调网关", async () => {
    delete process.env[COLLECT_TOKEN_ENV];
    const { controller, account } = createController();
    await expect(
      controller.order(
        { tier_id: "tier-1", payment_method: "wechat" },
        "Bearer sk-user",
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: "下单服务不可用",
    });
    expect(account.resolveTokenIdentity).not.toHaveBeenCalled();
    expect(account.createCollectTopUp).not.toHaveBeenCalled();
    expect(account.requestTopUpAmount).not.toHaveBeenCalled();
  });

  it("按档位实付代收，响应 amount 与卡片同为折后价", async () => {
    const { controller, account } = createController();
    const result = await controller.order(
      { tier_id: "tier-1", payment_method: "wechat" },
      "Bearer sk-user",
    );
    expect(account.resolveTokenIdentity).toHaveBeenCalledWith("sk-user");
    expect(account.createCollectTopUp).toHaveBeenCalledWith({
      collectToken: "secret-collect",
      userId: 42,
      money: 33.3,
      amount: 37,
      wayCode: "WX_NATIVE",
    });
    expect(account.requestTopUpAmount).not.toHaveBeenCalled();
    expect(account.createBlueWhalePayTopUp).not.toHaveBeenCalled();
    expect(result).toEqual({
      code: 200,
      msg: null,
      data: {
        trade_no: "BWP9",
        qr_code_url: "weixin://pay/qr",
        expire_time: "2026-08-29T10:15:00.000Z",
        amount: 33.3,
        points: 370,
      },
    });
  });

  it("代收凭证被网关拒绝时 502，不把钥名给调用方", async () => {
    const { controller, account } = createController();
    account.createCollectTopUp.mockRejectedValue(
      new NewApiError("下单服务不可用", 502, "topup_collect_auth_error"),
    );
    await expect(
      controller.order(
        { tier_id: "tier-1", payment_method: "alipay" },
        "Bearer sk-user",
      ),
    ).rejects.toMatchObject({
      status: 502,
      message: "下单服务不可用",
    });
  });
});
