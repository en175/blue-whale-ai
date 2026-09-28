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
 *
 * ⚠️ 这里有**两类**问题，判据不同（2026-09-27 分清）：
 *   · 「这件商品要不要复用那张未支付单」—— 看商品身份（类型 + 档位 + 积分 + **金额**）；
 *   · 「这个人是不是已经有一笔钱付了还没落地」—— **不看身份也不看金额**（B-2）：
 *     绑上身份的话，运营在用户在途时改一次价就能绕开它，同一笔钱会被收两次。
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

  it("★ 运营改价后同档位再点一次：**算换了商品**，按新价建新单（界面不会出现两个金额）", async () => {
    // 现网路径：用户看着 ¥100 点了下单（未付）→ 运营把这一档改到 ¥120 → 用户回来再点一次。
    // 此前商品身份不含金额，于是复用返回的是**旧单冻结的 ¥100**，而界面上的目录价已经是
    // ¥120 —— 同一个屏幕上同时出现两个金额（违反本仓硬约束），方向还可能多收用户的钱。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.amount).toBe(100);

    setTier({ price: 120 });
    const after = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(after.tradeNo).not.toBe(before.tradeNo);
    expect(after.amount).toBe(120);
    // 旧单仍是它自己那一笔（按当时的价挂着），不会被改写、也不会被复用
    expect(orders.get(before.tradeNo)?.amount_fen).toBe(10_000n);
    expect(orders.get(after.tradeNo)?.amount_fen).toBe(12_000n);
    expect(unifiedOrders(http)).toHaveLength(2);
  });

  it("★ 价格没变时照旧复用（改价才换商品，不该把正常的重复点击也变成新单）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 改的是**别的**列（到账积分不动、价格不动）——同一件商品，仍应复用
    setTier({ isRecommended: true });
    const again = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(again.tradeNo).toBe(first.tradeNo);
    expect(orders.size).toBe(1);
    expect(unifiedOrders(http)).toHaveLength(1);
  });

  it("★ 钱已收到、还卡在发放中的单（paid_pending）：**既不建新单也不复用二维码**，409 拦住他", async () => {
    // 重复收款的真实路径：用户付了钱、发放失败 → 界面一直「等待支付结果…」→ 他关掉弹窗
    // 再打开，看到的是干净的空闲态 → 再买一笔、再付一次；旧单之后又被对账任务补发成功,
    // 于是用户被扣两次钱、走客服退款。这道闸必须在服务端。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(first.tradeNo)!.status = "paid_pending";

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /正在处理中/,
    );
    // 一笔新单都没建、网关一次都没打（更不会给他一张能再付一次的二维码）
    expect(orders.size).toBe(1);
    expect(unifiedOrders(http)).toHaveLength(1);
    expect(orders.get(first.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 409 的文案不再指向「充值记录」：那里是 billing 账本，未发放的单没有任何分录", async () => {
    // 用户照着一句「请前往『充值记录』查看进度」点过去，看到的是「暂无充值记录」——
    // 指了一个**看不到该单**的地方，比不说还糟。文案必须给一个真实可达的下一步。
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
    // 单号要带上：用户找客服时这是唯一能把两边对上的东西
    expect(message).toContain(first.tradeNo);
    // 真实可达的下一步：等（我们还在自愈），或者找人
    expect(message).toContain("稍后重试");
    expect(message).toContain("联系客服");
  });

  it("★ 到账异常（grant_failed）同样算活跃单：钱没退，再买一次就是重复收款", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 发放反复失败、已被标异常（钱仍在平台上，没有退回去）
    orders.get(first.tradeNo)!.status = "grant_failed";

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /正在处理中/,
    );
    expect(orders.size).toBe(1);
  });

  it("★ B-2：换一档**也拦** —— 判据是「已经付过一笔还没落地的钱」，与他想买什么无关", async () => {
    // 上一版把这条判定绑在「同一件商品」上，于是换一档 / 改价就能绕开它：
    // 用户在途时运营一改价，他再点一次不命中 → 建新单 → 再付一次 → 两笔都会到账。
    // 重复收款的依据不是「他这次想买什么」，而是「他有一笔钱付了还没落地」。
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, addTier } = await makeService();
    addTier(TIER_B);

    const stuck = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(stuck.tradeNo)!.status = "paid_pending";

    // 另一个档位也拦（钱没退，再付一次就是重复收款）
    await expect(
      service.createOrder({ userId: 9001, tierId: TIER_B.id }),
    ).rejects.toThrow(/正在处理中/);
    // 自定义充值那条路同样拦：判据与商品无关
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

    // 改价会把「金额身份」整个换掉：若判定还绑在身份上，这一下就绕过去了
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
