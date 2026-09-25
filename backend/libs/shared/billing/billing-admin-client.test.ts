import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BillingAdminConfigError,
  BillingAdminError,
  billingAdminUrl,
  fetchCreditsPerYuan,
  grantCredits,
} from "./billing-admin-client.js";

const ENV = { BILLING_ADMIN_URL: "http://billing.internal:4003/" };

function stub(body: unknown, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("billing-admin-client", () => {
  beforeEach(() => {
    vi.stubEnv("BILLING_ADMIN_URL", ENV.BILLING_ADMIN_URL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("管理端地址未配置 → 直接抛（发放配不出地址时不许静默跳过）", () => {
    expect(() => billingAdminUrl({})).toThrow(BillingAdminConfigError);
    expect(billingAdminUrl(ENV)).toBe("http://billing.internal:4003");
  });

  it("换算率从定价目录读，不是代码常量", async () => {
    stub({ catalogVersion: 3, creditsPerYuan: 15 });
    await expect(fetchCreditsPerYuan()).resolves.toBe(15);
  });

  it("没有生效目录（version=-1 / creditsPerYuan=-1）→ 抛，不回退默认值", async () => {
    stub({ catalogVersion: -1, creditsPerYuan: -1 });
    await expect(fetchCreditsPerYuan()).rejects.toThrow(BillingAdminConfigError);
  });

  it("发放：请求体用我们自己的交易单号做幂等键，source 是 purchased", async () => {
    const calls = stub({ lotId: 77 });
    const result = await grantCredits({ userId: 9001, credits: 1500, bizId: "RC1" });

    expect(calls[0]?.url).toBe("http://billing.internal:4003/admin/credits/grants");
    expect(calls[0]?.body).toEqual({
      userId: 9001,
      source: "purchased",
      amount: 1500,
      bizId: "RC1",
      bizType: "recharge",
    });
    expect(result).toEqual({ lotId: "77", duplicated: false });
  });

  it("重复发放（billing 409）→ 当成「已经发过了」的正常结果，不当成故障", async () => {
    stub({ code: "DUPLICATE" }, 409);
    await expect(grantCredits({ userId: 1, credits: 1500, bizId: "RC1" })).resolves.toEqual({
      lotId: "",
      duplicated: true,
    });
  });

  it("其它错误码 → 抛错（调用方要让网关重投）", async () => {
    stub({ code: "INTERNAL" }, 500);
    await expect(grantCredits({ userId: 1, credits: 1, bizId: "RC1" })).rejects.toThrow(
      BillingAdminError,
    );
  });
});
