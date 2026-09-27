import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import { SYSTEM_SETTINGS_SECRET_ENV } from "@lib/shared/system-settings/index.js";
import { TIER, makeHttp, makeService, type Tier } from "./recharge.testlib.js";
/* ============================================
 * 下单防重（PRD §6.7 / §7.5「服务端避免重复有效订单」）。
 *
 * 前端 `RechargeModal` 里的 `if (paying) return` 只挡得住「同一个页面上的连点」；
 * 换个入口、刷新页面、关掉弹窗再打开，请求照样到服务端。这里测的就是**服务端那一层**：
 * 同一件商品的未支付单还在，就不该再建一笔、更不该再打一次网关。
 *
 * ⚠️ 网关侧不允许同一个 `mchOrderNo` 重下一次单（`Uni_MchNo_MchOrderNo`），
 * 所以「复用」只能是**把存下来的那条链接还给他**，不能是「拿同一个单号再下一次」。
 * ============================================ */

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

/** 用来测「换了档位不算重复」的第二个档位（到账积分与价格都与 TIER 不同）。 */
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

    // 用户看到的是同一笔单、同一条链接 —— 「我要付这一笔」这句话的点几次都只有一个答案
    expect(second.tradeNo).toBe(first.tradeNo);
    expect(second.cashierUrl).toBe(first.cashierUrl);
    // 复用报的失效时刻**不晚于**建单时报的那个：前者按下单时刻 + 令牌有效期算，
    // 后者按应答回来的时刻算（晚几毫秒）。差值是保守方向，不会给出一个其实已失效的期限
    expect(Date.parse(second.expiresAt)).toBeLessThanOrEqual(Date.parse(first.expiresAt));
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(Date.now());
    // 金额与积分取**订单行里冻结的那一份**，不是重新算一遍
    expect(second.amount).toBe(first.amount);
    expect(second.credits).toBe(first.credits);

    expect(orders.size).toBe(1);
    // 关键：没有第二次统一下单（网关那边也就不会多出一笔支付单）
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
    // 旧的 ¥100 那笔仍然待支付（用户只是改了主意，不是点了两次）
    expect(orders.get(cheap.tradeNo)?.status).toBe("pending");
  });

  it("★ 同一档位但到账积分被改配 → 算换了商品（用户这次要的是另一件东西）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(7500);

    // 运营在后台把这款档位的到账积分从 7,500 改成 8,000
    setTier({ baseCredits: 8_000 });
    const after = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(after.tradeNo).not.toBe(before.tradeNo);
    expect(after.credits).toBe(8000);
    // 已经下过的那笔仍按冻结的 7,500 发（改配置不改已创建的订单）
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
    // 钱到了（回调/查单把它推到待发放或已到账）
    orders.get(first.tradeNo)!.status = "paid";

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(second.tradeNo).not.toBe(first.tradeNo);
    expect(orders.size).toBe(2);
  });

  it("★ 旧单的收银台令牌已过期：不把一张扫不了的二维码还给他，旧单同时被推到终态", async () => {
    makeHttp(1); // 网关侧仍是「支付中」
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 拨到 31 分钟前：银行收银台令牌（30 分钟）已失效，用户扫不了那张码
    orders.get(first.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(second.tradeNo).not.toBe(first.tradeNo);
    // 旧单不再是「永远 pending 的孤儿」——它被推到了明确终态
    expect(orders.get(first.tradeNo)?.status).toBe("expired");
  });

  it("★ 旧单其实早就付了（回调丢了）：重新下单前先把那笔补发到账，再建新单", async () => {
    const http = makeHttp(2); // 网关查单会说「支付成功」
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 钱不会因为「链接过期了」就消失：这一笔在重新下单的路径上被补发了
    expect(http.granted).toEqual([{ amount: 7500, bizId: first.tradeNo }]);
    expect(orders.get(first.tradeNo)?.status).toBe("paid");
    expect(second.tradeNo).not.toBe(first.tradeNo);
  });

  it("令牌期内、但链接拿不出来（本列上线前的存量单）→ 报错让他去看那一笔，不建新单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const existing = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 模拟本列上线前创建的行：有网关订单号，但没有存链接
    orders.get(existing.tradeNo)!.cashier_url = null;

    await expect(
      service.createOrder({ userId: 9001, tierId: TIER.id }),
    ).rejects.toThrow(/尚未支付/);
    // 没有第二笔：旧单还有效（令牌没过期），用户可能正扫着它
    expect(orders.size).toBe(1);
  });

  it("下单时网关就失败过的单（从没拿到链接）不拦着用户重下", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    http.failNextUnifiedOrders(1);
    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow();

    // 那一笔是「落了库、网关那一步就没成功」的孤儿单（pay_order_id 与链接都没有）。
    // 它不是一笔有效订单，不该把用户卡在「您有一笔尚未支付的订单」上半小时
    const retried = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(retried.cashierUrl).toContain("uniCashierNew.html");
    expect(orders.get(retried.tradeNo)?.pay_order_id).toBe("P-GATEWAY-1");
  });
});
