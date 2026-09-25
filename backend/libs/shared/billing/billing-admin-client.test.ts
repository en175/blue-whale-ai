import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BillingAdminConfigError,
  BillingAdminError,
  CatalogRejectedError,
  billingAdminUrl,
  fetchActiveCatalog,
  fetchCreditsPerYuan,
  grantCredits,
  publishCatalog,
} from "./billing-admin-client.js";

const ENV = { BILLING_ADMIN_URL: "http://billing.internal:4003/" };

function stub(body: unknown, status = 200) {
  const calls: { url: string; body: unknown; raw: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const raw = init?.body ? String(init.body) : "";
      calls.push({
        url: String(url),
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
        raw,
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

  /* ---------- 定价目录：读 / 发布 ---------- */

  it("读当前目录：连文档原文一起带回来（管理端页面的编辑起点）", async () => {
    const calls = stub({
      catalogVersion: 3,
      documentHash: "abc",
      ruleCount: 1,
      creditsPerYuan: 15,
      document: '{"schemaVersion":1}',
    });

    await expect(fetchActiveCatalog()).resolves.toEqual({
      catalogVersion: 3,
      documentHash: "abc",
      ruleCount: 1,
      creditsPerYuan: 15,
      document: '{"schemaVersion":1}',
    });
    expect(calls[0]?.url).toBe("http://billing.internal:4003/admin/catalogs/active");
  });

  it("读当前目录：没有生效版本时不抛（管理端要能显示「还没发布过」并从零建一份）", async () => {
    stub({ catalogVersion: -1, creditsPerYuan: -1 });

    await expect(fetchActiveCatalog()).resolves.toEqual({
      catalogVersion: -1,
      documentHash: "",
      ruleCount: 0,
      creditsPerYuan: -1,
      document: "",
    });
    // 同一端点，充值那条路径仍然必须抛 —— 换算率取不到就不该给用户报价
    await expect(fetchCreditsPerYuan()).rejects.toThrow(BillingAdminConfigError);
  });

  it("发布：请求体就是文档文本本身，不包一层 {document: ...}", async () => {
    const calls = stub({
      catalogVersion: 4,
      documentHash: "def",
      ruleCount: 1,
      creditsPerYuan: 15,
    });

    const document = '{"schemaVersion":1,"creditsPerYuan":15}';
    await expect(
      publishCatalog({ document, publishedBy: "42", note: "改价" }),
    ).resolves.toEqual({
      catalogVersion: 4,
      documentHash: "def",
      ruleCount: 1,
      creditsPerYuan: 15,
    });

    expect(calls[0]?.url).toBe(
      "http://billing.internal:4003/admin/catalogs?publishedBy=42&note=%E6%94%B9%E4%BB%B7",
    );
    // 逐字节等于原文：中间没有任何人重新序列化它（包一层就会多一次转义再解析）
    expect(calls[0]?.raw).toBe(document);
  });

  it("发布：文档被拒（400）→ 抛 CatalogRejectedError 并带上 billing 的原话", async () => {
    stub({ code: "INVALID_ARGUMENT", message: "baseUnit 指向不存在的维度 usage.x" }, 400);

    // 这是「改文档」而不是「等服务恢复」，所以类型必须与 BillingAdminError 分开：
    // 否则调用方只能靠状态码猜处置方向
    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(CatalogRejectedError);
    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(/usage\.x/);
  });

  it("发布：其它非 2xx → BillingAdminError（可重试的一类）", async () => {
    stub({ message: "网关超时" }, 502);

    await expect(
      publishCatalog({ document: "{}", publishedBy: "42" }),
    ).rejects.toThrow(BillingAdminError);
  });
});
