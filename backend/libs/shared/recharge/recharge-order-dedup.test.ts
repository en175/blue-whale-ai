import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import { SYSTEM_SETTINGS_SECRET_ENV } from "@lib/shared/system-settings/index.js";
import { TIER, makeHttp, makeService, type Tier } from "./recharge.testlib.js";

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

const TIER_B: Tier = {
  ...TIER,
  id: "8",
  name: "900积分",
  baseCredits: 900,
  originalPrice: 200,
  price: 200,
  sortOrder: 2,
  version: 4,
};

const unifiedOrders = (http: ReturnType<typeof makeHttp>) =>
  http.calls.filter((c) => c.url.endsWith("/api/pay/unifiedOrder"));

describe("RechargeService — 下单防重", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("★ 同一档位连点两次：只建一笔单、只打一次网关，第二次还他同一条收银台链接", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(second.tradeNo).toBe(first.tradeNo);
    expect(second.cashierUrl).toBe(first.cashierUrl);
    expect(Date.parse(second.expiresAt)).toBeLessThanOrEqual(Date.parse(first.expiresAt));
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(Date.now());
    expect(second.amount).toBe(first.amount);
    expect(second.credits).toBe(first.credits);

    expect(orders.size).toBe(1);
    expect(unifiedOrders(http)).toHaveLength(1);
  });

  it("防重按人隔离：另一个用户下单照常建新单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const mine = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const theirs = await service.createOrder({ userId: 9002, tierId: TIER.id });

    expect(theirs.tradeNo).not.toBe(mine.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("★ 换了档位不算重复：用户想换一档再买，不能拿旧档的单拦住他", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, addTier } = await makeService();
    addTier(TIER_B);

    const cheap = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const pricier = await service.createOrder({ userId: 9001, tierId: TIER_B.id });

    expect(pricier.tradeNo).not.toBe(cheap.tradeNo);
    expect(pricier.credits).toBe(900);
    expect(orders.get(cheap.tradeNo)?.status).toBe("pending");
  });

  it("★ 同一档位但到账积分被改配 → 算换了商品（用户这次要的是另一件东西）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(7500);

    setTier({ baseCredits: 8_000 });
    const after = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(after.tradeNo).not.toBe(before.tradeNo);
    expect(after.credits).toBe(8000);
    expect(orders.get(before.tradeNo)?.credits).toBe(7500n);
  });

  it("档位单与自定义单互不当重复（商品类型不同）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const tierOrder = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const customOrder = await service.createOrder({ userId: 9001, credits: 600 });

    expect(customOrder.tradeNo).not.toBe(tierOrder.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("自定义充值：同样的积分数复用，换个积分数则新建", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, credits: 600 });
    const again = await service.createOrder({ userId: 9001, credits: 600 });
    expect(again.tradeNo).toBe(first.tradeNo);
    expect(orders.size).toBe(1);

    const other = await service.createOrder({ userId: 9001, credits: 1500 });
    expect(other.tradeNo).not.toBe(first.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("★ 已支付的单不是「重复」：钱都收了，再买一笔就照常建新单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.status = "paid";

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(second.tradeNo).not.toBe(first.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("★ 运营改价后同档位再点一次：**算换了商品**，按新价建新单（界面不会出现两个金额）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.amount).toBe(100);

    setTier({ price: 120 });
    const after = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(after.tradeNo).not.toBe(before.tradeNo);
    expect(after.amount).toBe(120);
    expect(orders.get(before.tradeNo)?.amount_fen).toBe(10_000n);
    expect(orders.get(after.tradeNo)?.amount_fen).toBe(12_000n);
    expect(unifiedOrders(http)).toHaveLength(2);
  });

  it("★ 价格没变时照旧复用（改价才换商品，不该把正常的重复点击也变成新单）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    setTier({ isRecommended: true });
    const again = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(again.tradeNo).toBe(first.tradeNo);
    expect(orders.size).toBe(1);
    expect(unifiedOrders(http)).toHaveLength(1);
  });

  it("★ 钱已收到、还卡在发放中的单（paid_pending）：**既不建新单也不复用二维码**，409 拦住他", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.status = "paid_pending";

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /正在处理中/,
    );
    expect(orders.size).toBe(1);
    expect(unifiedOrders(http)).toHaveLength(1);
    expect(orders.get(first.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 409 的文案不再指向「充值记录」：那里是 billing 账本，未发放的单没有任何分录", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.status = "paid_pending";

    const message = await service
      .createOrder({ userId: 9001, tierId: TIER.id })
      .then(() => "")
      .catch((e: Error) => e.message);

    expect(message).not.toContain("充值记录");
    expect(message).toContain(first.tradeNo);
    expect(message).toContain("稍后重试");
    expect(message).toContain("联系客服");
  });

  it("★ 到账异常（grant_failed）同样算活跃单：钱没退，再买一次就是重复收款", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.status = "grant_failed";

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /正在处理中/,
    );
    expect(orders.size).toBe(1);
  });

  it("★ B-2：换一档**也拦** —— 判据是「已经付过一笔还没落地的钱」，与他想买什么无关", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, addTier } = await makeService();
    addTier(TIER_B);

    const stuck = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(stuck.tradeNo)!.status = "paid_pending";

    await expect(
      service.createOrder({ userId: 9001, tierId: TIER_B.id }),
    ).rejects.toThrow(/正在处理中/);
    await expect(service.createOrder({ userId: 9001, credits: 600 })).rejects.toThrow(
      /正在处理中/,
    );
    expect(orders.size).toBe(1);
  });

  it("★ B-2：运营在用户在途时**改价**也绕不开（这是上一版被削弱的那个口子）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const stuck = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(stuck.tradeNo)!.status = "paid_pending";

    setTier({ price: 120 });

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /正在处理中/,
    );
    expect(orders.size).toBe(1);
  });

  it("★ 钱已到账（paid）之后换一档照常买：拦的是「在途」，不是「买过」", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, addTier } = await makeService();
    addTier(TIER_B);

    const done = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(done.tradeNo)!.status = "paid";

    const other = await service.createOrder({ userId: 9001, tierId: TIER_B.id });
    expect(other.tradeNo).not.toBe(done.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("★ 旧单的收银台令牌已过期：不把一张扫不了的二维码还给他，旧单同时被推到终态", async () => {
    makeHttp(1);
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(second.tradeNo).not.toBe(first.tradeNo);
    expect(orders.get(first.tradeNo)?.status).toBe("expired");
  });

  it("★ 旧单其实早就付了（回调丢了）：重新下单前先把那笔补发到账，再建新单", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(http.granted).toEqual([{ amount: 7500, bizId: first.tradeNo }]);
    expect(orders.get(first.tradeNo)?.status).toBe("paid");
    expect(second.tradeNo).not.toBe(first.tradeNo);
  });

  it("令牌期内、但链接拿不出来（本列上线前的存量单）→ 报错让他去看那一笔，不建新单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const existing = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(existing.tradeNo)!.cashier_url = null;

    await expect(
      service.createOrder({ userId: 9001, tierId: TIER.id }),
    ).rejects.toThrow(/尚未支付/);
    expect(orders.size).toBe(1);
  });

  it("下单时网关就失败过的单（从没拿到链接）不拦着用户重下", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    http.failNextUnifiedOrders(1);
    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow();

    const retried = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(retried.cashierUrl).toContain("uniCashierNew.html");
    expect(orders.get(retried.tradeNo)?.pay_order_id).toBe("P-GATEWAY-1");
  });
});
