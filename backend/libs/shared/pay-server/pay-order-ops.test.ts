import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAY_WAY_CODE_HCCB_QR,
  PayGatewayError,
  queryOrder,
  unifiedOrder,
  type PayMerchantCredentials,
} from "./pay-order-ops.js";
import { paySign } from "./pay-sign.js";

const CREDENTIALS: PayMerchantCredentials = {
  mchNo: "M0001",
  appId: "app-1",
  appSecret: "s3cret",
};

const ENV = { PAY_SERVER_BASE_URL: "https://pay.example.com/" };

function stubGateway(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function sentPayload(calls: { init: RequestInit }[], index = 0): Record<string, unknown> {
  return JSON.parse(String(calls[index]?.init.body ?? "{}")) as Record<string, unknown>;
}

describe("pay-order-ops — 统一下单", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", ENV.PAY_SERVER_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("请求形状：POST /api/pay/unifiedOrder，金额单位是分，渠道是 HCCB_QR", async () => {
    const calls = stubGateway(200, {
      code: 0,
      msg: "SUCCESS",
      data: {
        payOrderId: "P2102290508813254658",
        orderState: 1,
        payDataType: "codeUrl",
        payData: "https://test.hccb.cc/uniCashierNew.html?tokenCode=abc",
      },
    });

    const result = await unifiedOrder({
      credentials: CREDENTIALS,
      mchOrderNo: "RC20260925120000abcdef",
      amountFen: 10_000,
      subject: "1000积分",
      body: "1000积分",
      notifyUrl: "https://api.example.com/api/recharge/notify/pay",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://pay.example.com/api/pay/unifiedOrder");
    expect(calls[0]?.init.method).toBe("POST");

    const payload = sentPayload(calls);
    expect(payload.mchNo).toBe("M0001");
    expect(payload.appId).toBe("app-1");
    expect(payload.wayCode).toBe(PAY_WAY_CODE_HCCB_QR);
    expect(payload.amount).toBe(10_000);
    expect(payload.currency).toBe("cny");
    expect(payload.notifyUrl).toBe("https://api.example.com/api/recharge/notify/pay");
    expect(payload.version).toBe("1.0");
    expect(payload.signType).toBe("MD5");
    const { sign, ...unsigned } = payload;
    expect(sign).toBe(paySign(unsigned, CREDENTIALS.appSecret));

    expect(result.payOrderId).toBe("P2102290508813254658");
    expect(result.cashierUrl).toBe("https://test.hccb.cc/uniCashierNew.html?tokenCode=abc");
    expect(result.orderState).toBe(1);
  });

  it("网关业务失败（code≠0）→ 抛 PayGatewayError 并带上网关文案", async () => {
    stubGateway(200, { code: 9999, msg: "商户应用不支持该支付方式" });
    await expect(
      unifiedOrder({
        credentials: CREDENTIALS,
        mchOrderNo: "RC1",
        amountFen: 100,
        subject: "s",
        body: "b",
        notifyUrl: "https://api.example.com/notify",
      }),
    ).rejects.toThrow(/商户应用不支持该支付方式/);
  });

  it("应答缺收银台链接 → 抛错（不发一笔「到不了收银台」的单）", async () => {
    stubGateway(200, { code: 0, msg: "SUCCESS", data: { payOrderId: "P1", orderState: 1 } });
    await expect(
      unifiedOrder({
        credentials: CREDENTIALS,
        mchOrderNo: "RC1",
        amountFen: 100,
        subject: "s",
        body: "b",
        notifyUrl: "https://api.example.com/notify",
      }),
    ).rejects.toThrow(/收银台链接/);
  });

  it("网关地址未配置 → 抛配置错误（不是发出一个 undefined 的请求）", async () => {
    vi.unstubAllEnvs();
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      unifiedOrder({
        credentials: CREDENTIALS,
        mchOrderNo: "RC1",
        amountFen: 100,
        subject: "s",
        body: "b",
        notifyUrl: "https://api.example.com/notify",
      }),
    ).rejects.toThrow(/PAY_SERVER_BASE_URL/);
  });
});

describe("pay-order-ops — 查单", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", ENV.PAY_SERVER_BASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("按商户订单号查：请求形状与状态解析", async () => {
    const calls = stubGateway(200, {
      code: 0,
      msg: "SUCCESS",
      data: { payOrderId: "P1", mchOrderNo: "RC1", state: 2, amount: 100 },
    });

    const result = await queryOrder({ credentials: CREDENTIALS, mchOrderNo: "RC1" });

    expect(calls[0]?.url).toBe("https://pay.example.com/api/pay/query");
    const payload = sentPayload(calls);
    expect(payload.mchOrderNo).toBe("RC1");
    expect(payload.payOrderId).toBeUndefined();
    expect(result).toEqual({ payOrderId: "P1", mchOrderNo: "RC1", state: 2, amountFen: 100 });
  });

  it("两个单号都不给 → 直接抛，不发无意义的请求", async () => {
    stubGateway(200, { code: 0, msg: "SUCCESS", data: {} });
    await expect(queryOrder({ credentials: CREDENTIALS })).rejects.toThrow(PayGatewayError);
  });
});
