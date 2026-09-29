import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsService,
} from "@lib/shared/system-settings/index.js";
import type { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import {
  APP_SECRET,
  NOTIFY_URL,
  TIER,
  makeHttp,
  makePrisma,
  makeService,
  notifyParams,
  signed,
} from "./recharge.testlib.js";
import { creditsExpireAt } from "./credits-validity.js";
import { GRANT_RETRY_WINDOW_MS } from "./recharge-grant-sweeper.js";
import { RechargeService } from "./recharge.service.js";
/* ============================================
 * 充值到账的账实一致：这是钱路径，测的是「会不会多发一次」「会不会按错的数发」。
 *
 * 用内存假 Prisma 而不是 vi.fn 桩：条件更新（`status != paid`、查单名额）正是幂等的实现本身，
 * 桩掉它等于把要测的东西测没。夹具在 `recharge.testlib.ts`（自定义充值那条链路共用同一套）。
 *
 * ⚠️ 换算率（`fetchCreditsPerYuan`）读的是**定价目录的 gRPC 接口**，不再是 HTTP ——
 *    所以它由 `grpcActiveCatalog()` 桩，HTTP 那套只剩发放（`grantCredits` 尚未迁）。
 * ============================================ */

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});


describe("RechargeService — 下单", () => {
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

  it("★ 积分冻结的是**档位配的基础积分**（配置值），不是「原价 × 换算率」", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 100 元 → 10000 分；到账 7,500 积分（档位配的），**不是** 100 × 15 = 1500
    expect(created.amount).toBe(100);
    expect(created.credits).toBe(7500);
    expect(created.cashierUrl).toContain("uniCashierNew.html");
    expect(created.tradeNo).toMatch(/^RC\d{14}[0-9a-f]{8}$/);

    const order = orders.get(created.tradeNo);
    expect(order?.amount_fen).toBe(10_000n);
    expect(order?.credits).toBe(7500n);
    // 换算率仍快照进订单，但它现在只回答「下单那一刻口径是多少」（对账/追溯），
    // **不参与积分计算** —— 上面那个 7,500 与它无关
    expect(order?.credits_per_yuan).toBe(15);
    expect(order?.status).toBe("pending");
    expect(order?.pay_order_id).toBe("P-GATEWAY-1");

    const unified = http.calls.find((c) => c.url.endsWith("/api/pay/unifiedOrder"));
    expect(unified?.body.amount).toBe(10_000);
    expect(unified?.body.wayCode).toBe("HCCB_QR");
    expect(unified?.body.notifyUrl).toBe(NOTIFY_URL);
  });

  it("★ 换算率改成 20 后：档位展示**不变**（积分是配置值），已下订单仍按冻结的数发", async () => {
    makeHttp();
    const catalog = grpcActiveCatalog();
    const { service, orders } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(7500);

    catalog.setCreditsPerYuan(20);
    // 档位积分与换算率**无关**：¥100 的档还是 7,500 积分，不是 100 × 20 = 2000。
    // 换算率回给前端只为渲染「1 元 = 20 积分」那句提示（消费锚点口径）。
    expect((await service.listTiers()).tiers[0]?.amount).toBe(7500);
    expect((await service.listTiers()).creditsPerYuan).toBe(20);

    // 旧订单没被改口径影响：它冻结的就是 7500
    const order = orders.get(before.tradeNo);
    expect(order?.credits).toBe(7500n);
  });

  it("下单写入 9 个快照字段：config_version 取档位**当时**的 version", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTierVersion } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const row = orders.get(first.tradeNo);
    expect(row?.product_type).toBe("tier");
    // 商品名是**用户当时看到的展示名**，不是库里那列原始名——自动生成的名字会随积分
    // 重新派生（`displayTierName`），快照要回答的是「用户当时看到的是哪件商品」
    expect(row?.product_name).toBe("7500积分");
    // 首购两列此刻还是常量（#40 首购加赠落地后才变成计算值）
    expect(row?.bonus_credits).toBe(0n);
    expect(row?.first_purchase_state).toBe("unknown");
    expect(row?.first_purchase_eligible).toBe(0);
    // 权限结果落库**只可能是 allowed**（被拒的用户在下单路径上已经吃了 403，建不了单），
    // 所以写入侧写的是常量、不是一个走不到三元 —— 这一列现在的意义是
    // 「记下判定发生在哪」：判定确实在下单路径上发生过，结果随单落库
    expect(row?.permission_result).toBe("allowed");
    expect(row?.config_version).toBe(3);
    // ⚠️ 有效期快照的是**月数**（运营在后台配的那个数），不是算好的时刻：
    // 起算点是支付成功时刻（PRD §9.5），下单这一刻根本还不知道它
    expect(row?.credits_valid_months).toBe(24);
    expect(row?.credits_expire_at).toBeNull();

    // 运营改配置（保存一次 version +1）之后：新单记新版本，**老单不动**——快照的意义就在这
    //
    // ⚠️ 先把第一笔推到已到账再下第二笔：下单防重（PRD §7.5）会把「同一商品 + 同一用户 +
    //    尚未支付」的第二次下单**复用**成同一笔，那样就没有第二单可比版本了。
    //    这也正是真实用户的路径：付完了才会再买一笔。
    orders.get(first.tradeNo)!.status = "paid";
    setTierVersion(4);
    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(orders.get(second.tradeNo)?.config_version).toBe(4);
    expect(orders.get(first.tradeNo)?.config_version).toBe(3);
  });

  it("★ 档位配的有效期月数进快照：换一档就是换一个数（不是写死的 2 年）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    setTier({ creditsValidMonths: 6 });
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(orders.get(created.tradeNo)?.credits_valid_months).toBe(6);
  });

  it("★ 档位购买权限：不在白名单 → 403 带后台配的提示，且**一笔单都不建**", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该档位仅限内测用户",
    });

    // 判定的落点必须在**下单路径**上：这一列在管理端可编辑、保存时校验得很严，
    // 但此前没有任何人读它 —— 运营配「仅限白名单」，用户侧人人都能买且没有报错
    await expect(service.createOrder({ userId: 7007, tierId: TIER.id })).rejects.toThrow(
      /该档位仅限内测用户/,
    );
    expect(orders.size).toBe(0);
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);

    // 名单里的用户照常下单
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(created.credits).toBe(7500);
  });

  it("★ 档位没配提示文案时用默认文案（不能把空串当提示展示）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({ permission: "user_group", permissionAllowlist: [] });

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /暂不可购买该档位/,
    );
  });

  it("★ `member_tier` 权限本阶段只是占位：不拦人（PRD §10.4 阶段 2 生效）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({ permission: "member_tier", permissionAllowlist: [] });

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(created.credits).toBe(7500);
  });

  it("★ listTiers 带上权限信号：游客未判定、白名单外的用户 false（PRD §6.3 置灰）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该档位仅限内测用户",
    });

    // 游客：价格表是公开的（能看），只是**未判定**——与自定义充值那条同一个口径
    const guest = await service.listTiers(null);
    expect(guest.tiers[0]?.canPurchase).toBeNull();
    expect(guest.tiers[0]?.deniedHint).toBe("该档位仅限内测用户");

    // 白名单外的登录用户：卡片要置灰，并带上后台配的提示
    const denied = await service.listTiers(7007);
    expect(denied.tiers[0]?.canPurchase).toBe(false);

    // 名单里的用户：可买（目录与下单路径用的是同一个判定函数，不会两边打架）
    const allowed = await service.listTiers(9001);
    expect(allowed.tiers[0]?.canPurchase).toBe(true);
  });

  it("★ 默认不传 userId = 游客视角：`can_purchase` 为 null（未判定），不是 false", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    // false 的意思是「这个用户不能买」，而「不知道是谁」不该被显示成一张灰卡片
    expect((await service.listTiers()).tiers[0]?.canPurchase).toBeNull();
  });

  it("档位下架 → 拒绝下单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: APP_SECRET,
        hccb_notify_url: NOTIFY_URL,
      },
    });
    const tiers = {
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "inactive" as const }),
    } as unknown as TopupTierService;
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(/已下架/);
  });

  it("★ 档位还是草稿 → 拒绝下单，且**不说「已下架」**", async () => {
    // 草稿与下架都不可买，但话不能说成同一句（PRD §6.3 / §10.5）：
    // 「已下架」说的是一个曾经卖过的东西，而草稿是还没上过架 ——
    // 对着一张运营刚建好、字段还没配齐的卡片说「已下架」，客服和用户都无从下手。
    makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: APP_SECRET,
        hccb_notify_url: NOTIFY_URL,
      },
    });
    const tiers = {
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "draft" as const }),
    } as unknown as TopupTierService;
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(
      /尚未上架/,
    );
  });

  it("商户凭证没配全 → 拒绝下单，不带着半份配置去调用网关", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: { hccb_mch_no: "M0001", hccb_app_id: "", hccb_app_secret: "", hccb_notify_url: "" },
    });
    const tiers = {
      listActive: async () => [TIER],
      getById: async () => TIER,
    } as unknown as TopupTierService;
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(
      /支付商户信息未配置完整/,
    );
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);
  });
});


describe("RechargeService — 回调到账", () => {
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

  it("首次回调：先置 paid_pending（钱到了）再发放、最后置 paid（积分也发了）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(true);

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    const order = orders.get(created.tradeNo);
    expect(order?.status).toBe("paid");
    expect(order?.grant_lot_id).toBe(42n);
    expect(order?.paid_at).toBeInstanceOf(Date);
    // 顺序本身要钉住：只看最终值是 paid 的话，「先写 paid、事后补一次 paid_pending」也是绿的。
    // 发放失败时订单必须**看得见**地停在 paid_pending，这个顺序就是那个保证。
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
  });

  it("★ 到账把配的有效期**真的**传给了 billing，起算点是支付成功时刻（PRD §9.5）", async () => {
    // 这条守的是「运营配了 6 个月却按 2 年发」那个缺陷：`credits_valid_months` 在整条
    // 下单/到账链路上曾经**没有任何读方**，配置是个摆设。现在发放时按
    // `paid_pending_at + 月数` 算出 expiresAt 显式传过去（billing 的 GrantPolicy 支持覆盖）。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ creditsValidMonths: 6 });
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(true);

    const row = orders.get(created.tradeNo);
    const paidPendingAt = row?.paid_pending_at as Date;
    // 起算点 = 钱到的时刻（不是下单时刻）：用户犹豫的那半小时不该从有效期里扣掉
    const expected = creditsExpireAt(paidPendingAt, 6);
    expect(row?.credits_expire_at).toEqual(expected);
    // 传给 billing 的必须是**同一个值**：订单快照与真实发放不能是两个数
    expect(http.grantBodies[0]?.expiresAt).toBe(expected.toISOString());
  });

  it("有效期快照缺失（本列上线前的存量单）→ 不显式传 expiresAt，由 billing 按来源策略发", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 模拟本列上线前建的行：没有有效期月数快照
    orders.get(created.tradeNo)!.credits_valid_months = null;

    await service.handleNotify(await signed(notifyParams(created.tradeNo)));

    // 不传 ≠ 传 null：后者会让报文里多一个我们不打算表达的空值
    expect("expiresAt" in (http.grantBodies[0] ?? {})).toBe(false);
    expect(orders.get(created.tradeNo)?.credits_expire_at).toBeNull();
  });

  it("重复回调（网关重投）：积分只发一次，且仍应答 SUCCESS", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);

    // 本地这把锁的效果：重投被 `status=paid` 短路，**一次都没再打 billing**
    const grants = http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"));
    expect(grants).toHaveLength(1);
    // 后面两次也没再写状态（短路发生在状态写入之前）
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
    // billing 那把锁的效果：积分只发了一次
    expect(http.granted).toHaveLength(1);
    expect(http.granted[0]?.amount).toBe(7500);
  });

  it("已是 paid_pending 的重投：**重试发放**（白给的重试机会不能短路掉）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    // 第一次发放失败 → 订单停在 paid_pending（钱到了，积分没发）
    http.failNextGrants(1);
    expect(await service.handleNotify(params)).toBe(false);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    // 网关重投：这时**不能**像 paid 那样短路，要继续往下走真的再发一次
    expect(await service.handleNotify(params)).toBe(true);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    // 两次发放请求（第二次才成功）；paid_pending 只写了一次——「钱还没到」的条件更新挡住了重写
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(2);
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
  });

  it("回调金额与订单不符：不发放、不应答 SUCCESS（让网关重投并留痕）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const tampered = await signed(notifyParams(created.tradeNo, { amount: "1" }));
    expect(await service.handleNotify(tampered)).toBe(false);

    expect(http.granted).toHaveLength(0);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });

  it("验签失败：不发放、不应答 SUCCESS", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const forged = { ...notifyParams(created.tradeNo), sign: "0".repeat(32) };
    expect(await service.handleNotify(forged)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("订单不存在：不应答 SUCCESS（不把异常吞成成功）", async () => {
    const http = makeHttp();
    const { service } = await makeService();
    const params = await signed(notifyParams("RC-NOT-EXIST"));
    expect(await service.handleNotify(params)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("非终态通知：不应答 SUCCESS（契约说只通知终态，来了就是异常）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo, { state: "1" }));
    expect(await service.handleNotify(params)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("渠道不符 / 支付方式不符：拒绝（这条通道只认杭州银行）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(
      await service.handleNotify(await signed(notifyParams(created.tradeNo, { ifCode: "wxpay" }))),
    ).toBe(false);
    expect(
      await service.handleNotify(await signed(notifyParams(created.tradeNo, { wayCode: "ALI_QR" }))),
    ).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("发放失败（billing 不可用）：不应答 SUCCESS，订单停在 paid_pending 而不是退回 pending", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 换掉 fetch：发放接口 500。目录与余额都走 gRPC，不经过这里 —— 所以除了发放
    // 之外的请求一律抛，避免把「多打了一个 HTTP」当成通过
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/admin/credits/grants")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`未预期的请求：${String(url)}`);
      }),
    );

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(false);
    // 停在 paid_pending 是本次设计的重点：这条单**钱已经收了**，客服一眼能看出来；
    // 退回 pending 就与「用户还没付钱」不可分辨（那是扩状态前的老毛病）
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
    expect(statusWrites).toEqual(["paid_pending"]);
  });
});

describe("RechargeService — 首购加赠（每档首次）", () => {
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

  it("★ 同一档位第一笔支付发赠送批次，第二笔不发（幂等键按用户+档位裁决）", async () => {
    // 这条守的是「档位配了 bonus_credits、下单路径从来没读过它」那个缺陷：
    // 管理端在宣传「首购加赠 1000 分」，而钱照收、分不发。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ firstPurchaseEligible: true, bonusCredits: 1_000 });

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(orders.get(first.tradeNo)?.bonus_credits).toBe(1_000n);
    expect(await service.handleNotify(await signed(notifyParams(first.tradeNo)))).toBe(true);

    // 两笔发放：本金 + 赠送
    expect(http.granted).toEqual([
      { amount: 7_500, bizId: first.tradeNo },
      { amount: 1_000, bizId: first.tradeNo },
    ]);
    expect(http.grantBodies[1]).toMatchObject({
      source: "bonus",
      // ⚠️ 幂等键按 **用户+档位** 取，不是按订单：判「谁是首单」的是它
      grantKey: `bonus:tier:9001:${TIER.id}`,
    });
    expect(orders.get(first.tradeNo)?.first_purchase_state).toBe("first");

    // ── 第二笔：**另一张订单**，同样的键 → billing 回 409 → 不发赠送 ──
    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(await service.handleNotify(await signed(notifyParams(second.tradeNo)))).toBe(true);

    // 只多了本金那一笔，没有第二笔赠送
    expect(http.granted).toEqual([
      { amount: 7_500, bizId: first.tradeNo },
      { amount: 1_000, bizId: first.tradeNo },
      { amount: 7_500, bizId: second.tradeNo },
    ]);
    expect(orders.get(second.tradeNo)?.first_purchase_state).toBe("repeat");
    // 快照仍记着「这单挂着 1000 赠送」，实际没发 —— 两列合起来才讲得清
    expect(orders.get(second.tradeNo)?.bonus_credits).toBe(1_000n);
  });

  it("★ 重放不会把「本单发出的赠送」记成 repeat（撞键要看归属）", async () => {
    // 发放成功、但进程在写订单状态之前死掉 —— 网关重投 / 对账 / 人工补发都会把
    // fulfill 再跑一遍，于是**两笔发放都撞回 409**。
    // 只按「撞没撞键」判，就会给「确实发出了赠送的那一单」写上 repeat，
    // 而那是个假事实：这一列将来要回答「用户到底拿到赠送没有」。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ firstPurchaseEligible: true, bonusCredits: 1_000 });

    const order = await service.createOrder({ userId: 9001, tierId: TIER.id });
    await service.handleNotify(await signed(notifyParams(order.tradeNo)));
    expect(orders.get(order.tradeNo)?.first_purchase_state).toBe("first");

    // 造那个「死在中途」的状态：积分发了，状态没落
    const row = orders.get(order.tradeNo)!;
    row.status = "paid_pending";
    row.first_purchase_state = "unknown";

    await service.handleNotify(await signed(notifyParams(order.tradeNo)));

    // 两次发放都 409，但键归本单 → 是重放，仍然 first
    expect(orders.get(order.tradeNo)?.first_purchase_state).toBe("first");
    expect(http.granted).toEqual([
      { amount: 7_500, bizId: order.tradeNo },
      { amount: 1_000, bizId: order.tradeNo },
    ]);
  });

  it("档位不参与首购：不发赠送批次，状态保持 unknown", async () => {
    // 夹具默认就是不参与；这里钉住「不参与 ≠ 判定为重复」——
    // 那是两件不同的事，写成 repeat 会让运营以为用户已经用过了。
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await service.handleNotify(await signed(notifyParams(created.tradeNo)));

    expect(http.granted).toEqual([{ amount: 7_500, bizId: created.tradeNo }]);
    const row = orders.get(created.tradeNo);
    expect(row?.bonus_credits).toBe(0n);
    expect(row?.first_purchase_state).toBe("unknown");
  });
});

describe("RechargeService — 查单补偿（回调丢失时）", () => {
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

  it("网关侧已支付而回调丢了 → 用户查单时补发积分", async () => {
    const http = makeHttp(2); // 网关查单返回「支付成功」
    // 只装目录（下单要换算率），**不装**查余额那条：余额查不到不该让查单整体失败
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(state.creditsAfter).toBeNull();
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("查单补偿有限流：同一笔订单 30 秒内不重复问网关", async () => {
    const http = makeHttp(1);
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    const queries = http.calls.filter((c) => c.url.endsWith("/api/pay/query"));
    expect(queries).toHaveLength(1);
  });

  it("令牌过期且网关未成功 → 置过期（给用户明确终态，不让轮询一直转）", async () => {
    makeHttp(1); // 网关侧仍是「支付中」
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 把建单时间拨到 31 分钟前（银行收银台令牌已失效）
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("expired");
    expect(orders.get(created.tradeNo)?.status).toBe("expired");
  });

  it("网关说成功时，即使本地已过令牌期也以到账为准（钱比时钟权威）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
  });

  it("★ 停在「待到账」的单，用户轮询会**补发**（不补就永远卡在发放中）", async () => {
    // ⚠️ 这条守的是**拆状态引入的一个回归**：网关重投窗口只有约 15 分钟，过了就没人补发。
    //    拆状态之前，发放失败的单留在 `pending`，用户轮询会经 reconcile（问网关→补发）自愈；
    //    拆完之后单停在 `paid_pending`，而查询路径若只认 `pending`，这类单就**再也不会自愈** ——
    //    用户永远停在「发放中」，比旧行为还差。
    //
    //    补发不再问网关（钱已确认收到），直接调 fulfill：它先 markPaidPending（条件更新，
    //    已达则不动作）再发放，发放走 billing 的幂等键，重复调用不会重复发积分。
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 造出「钱到了、积分没发成功」——这正是 paid_pending 要表达的那个状态
    orders.get(created.tradeNo)!.status = "paid_pending";

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(state.status).toBe("paid");
  });

  it("★ 标成 `grant_failed` 的单，用户轮询也**补发**（两条自愈路径行为一致）", async () => {
    // ⚠️ 这条守的是「单子坏了时，两条自愈路径不该不一样」：`grant_failed` 与
    //    `paid_pending` 说的是同一件事（钱到了、积分没发出去），只是失败次数多到被标了出来。
    //    此前只有 `paid_pending` 走补发，于是用户**守着页面也推不动**一笔异常单 ——
    //    只有扫描器能推，而扫描器超窗（默认 2 小时）就停了。
    //
    //    窗口与限流 `retryFulfill` 内部已有（下面两条用例各自钉住），这里钉的是**分派**：
    //    `grant_failed` 必须进得了那条分支。
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "grant_failed";

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(state.status).toBe("paid");
  });

  it("★ `grant_failed` 的超窗单：同样只回状态、不再打 billing（补发规则对它一并生效）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "grant_failed";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    // 如实回原状态（不是替人改成 paid、也不是退回 paid_pending）
    expect(state.status).toBe("grant_failed");
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");
  });

  it("★ 补发走限流：30 秒内用户轮询多次，只打一次 billing", async () => {
    // 这段守的是「billing 挂掉时被打爆」：前端每 3 秒轮一次，每次补发都是一次真实的
    // billing 调用 —— 不限流的话一个开着弹窗的用户每天就是 2.8 万次注定失败的调用
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    // 让发放一直失败：订单留在 paid_pending，才谈得上「下一次轮询还要不要重试」
    http.failNextGrants(10);

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    // 名额与「查单补偿」共用（claimQuerySlot / 30 秒），所以是**一次**真实的发放请求
    expect(http.grantBodies).toHaveLength(1);
    // 状态如实回 paid_pending：发放失败不该让查单接口也失败，「发放中」本身就是有效答案
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 超出重试窗口的 paid_pending：只回状态，**不再打 billing**（也不改状态）", async () => {
    // 「超窗就不再重试」这条规则此前只对定时任务成立：用户轮询那条路**每次**都打 billing。
    // 一个坏掉的单因此会被开着页面的用户永远重试下去（每 3 秒一次）。
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    // 钱到的时刻拨到 3 小时前（窗口是 2 小时）
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    // 如实回状态：没有「放弃」这个状态，也不该替人把它标成某种「处理过」
    expect(state.status).toBe("paid_pending");
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("存量单没有 paid_pending_at：退回按下单时刻判窗口（更宽松，好过永远扫不到）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = null; // 本列上线前进入该状态的行
    // 下单时刻拨到 3 小时前 —— 已经超窗，不再打 billing
    row.gmt_create = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("paid_pending");
  });

  it("别人的订单当作不存在：不泄漏「这个单号存在」", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    await expect(
      service.getOrderStatus({ userId: 1234, tradeNo: created.tradeNo }),
    ).rejects.toThrow(/订单不存在/);
  });
});

describe("RechargeService — 档位目录带上有效期（C-1）", () => {
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

  it("★ 有效期**逐档**回给前端：不同档位拿到不同的数（不是整页一个写死的 2 年）", async () => {
    // 有效期是按商品可配的，而 C 把配置接通之后「配 6 个月」是真的生效。
    // 目录接口一个字都不说的话，用户侧就只能照着写死的一句「2 年内有效」念 ——
    // 那句话对配了 6 个月的那一档就是假的。
    makeHttp();
    grpcActiveCatalog();
    const { service, addTier, setTier } = await makeService();

    setTier({ creditsValidMonths: 6 });
    addTier({ ...TIER, id: "8", name: "高级", creditsValidMonths: 24 });

    const catalog = await service.listTiers();

    const byId = new Map(catalog.tiers.map((t) => [t.id, t.creditsValidMonths]));
    expect(byId.get("7")).toBe(6);
    expect(byId.get("8")).toBe(24);
  });

  it("默认档位把后台配的月数原样带出来（游客也要能拿到，价格表本来就是公开信息）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    const catalog = await service.listTiers();

    expect(catalog.tiers[0]?.creditsValidMonths).toBe(TIER.creditsValidMonths);
  });
});

describe("RechargeService — 超窗 WARN 的频次（M-1）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** 把一笔订单造成「钱在 3 小时前到账、积分一直没发出去」（已超出 2 小时窗口）。 */
  async function makeOverWindowOrder() {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const made = await makeService();
    const created = await made.service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = made.orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);
    return { ...made, http, tradeNo: created.tradeNo };
  }

  it("★ 同一笔超窗单被轮询多次，WARN 只出现一次（名额是 30 秒，不压就是 2880 条/天）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo } = await makeOverWindowOrder();

    // 用户每 3 秒轮一次，连着轮 10 次 —— 名额会让其中若干次真的走到窗口判定那一步
    for (let i = 0; i < 10; i += 1) {
      await service.getOrderStatus({ userId: 9001, tradeNo });
    }

    const lines = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(lines).toHaveLength(1);
  });

  it("★ 压的是频次、不是可见性：超窗这件事仍然报得出来（带单号与已等多久）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo } = await makeOverWindowOrder();

    await service.getOrderStatus({ userId: 9001, tradeNo });

    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(line).toBeDefined();
    expect(line).toContain(tradeNo);
    // 时间戳那一行必须还在：把频次压掉，不代表把「这事拖了多久」也压掉
    expect(line).toContain("已等=180 分钟");
  });

  it("★ 超窗的门票仍然一次都不打 billing（压频次没把重试也改回去）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo, http } = await makeOverWindowOrder();

    for (let i = 0; i < 5; i += 1) {
      await service.getOrderStatus({ userId: 9001, tradeNo });
    }

    expect(http.grantBodies).toHaveLength(0);
  });
});

describe("RechargeService — 重试窗口两条路同一个值", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * 运维按扫描器注释的邀请把窗口调小的那个值（45 分钟）。
   *
   * <p>取 45 而不是随便一个数：它**明显不同于默认的 120**，任何「这条路上还是写死的 120」
   * 的实现都会在这几条用例里红。
   */
  const TUNED_WINDOW_MS = 45 * 60 * 1000;

  /** 造一笔「钱到账 **50 分钟**了、积分一直没发出去」的单：默认 2 小时窗口内、45 分钟窗口外。 */
  async function makeOrderHeld50Min(grantRetryWindowMs?: number) {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const made = await makeService(
      grantRetryWindowMs === undefined ? {} : { grantRetryWindowMs },
    );
    const created = await made.service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = made.orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 50 * 60 * 1000);
    return { ...made, http, tradeNo: created.tradeNo };
  }

  it("★ 窗口调成 45 分钟：用户轮询那条路也按 45 分钟停（不再是硬编码的 120）", async () => {
    // 此前这条路的窗口是代码里的常量，而扫描器读的是可配的 env：运维把
    // `RECHARGE_GRANT_RETRY_WINDOW_MS` 调大（扫描器注释明确邀请这么做）之后，
    // 用户轮询那条仍在 2 小时就停，WARN 里还写着「超出 120 分钟」—— 与真实配置不符。
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo, http } = await makeOrderHeld50Min(TUNED_WINDOW_MS);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo });

    // 50 分钟 > 45 分钟 → 超窗、一次 billing 都不打
    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("paid_pending");
    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(line).toBeDefined();
    // 分钟数跟着**真实配置**走：写死 120 的实现会在这两条断言上红
    expect(line).toContain("45 分钟");
    expect(line).not.toContain("120 分钟");
  });

  it("★ 同一个 45 分钟也管着扫描器：这一轮取不到它（进 abandoned、一单都不重试）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders, tradeNo, http } = await makeOrderHeld50Min(TUNED_WINDOW_MS);

    // 不传 retryWindowMs：扫描器必须用**服务注入的那一个**（否则两条路各用各的窗口）
    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toMatchObject({ scanned: 0, healed: 0, abandoned: 1 });
    expect(http.grantBodies).toHaveLength(0);
    // 超窗不改状态（没有「放弃」这个状态）：它只是不再被重试
    expect(orders.get(tradeNo)?.status).toBe("paid_pending");
    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_exhausted"));
    expect(JSON.parse(line as string)).toMatchObject({ count: 1, window_minutes: 45 });
  });

  it("★ 默认（2 小时）下同一笔单两条路都放行：可配不等于默认被改掉", async () => {
    const { service, tradeNo, http } = await makeOrderHeld50Min();

    const state = await service.getOrderStatus({ userId: 9001, tradeNo });

    // 50 分钟落在默认窗口内 → 用户轮询真的补发（走通了才说明上一条不是「一律拒绝」）
    expect(http.grantBodies).toHaveLength(1);
    expect(state.status).toBe("paid");
  });
});

describe("RechargeService — 管理端人工补发（E-1 的第三条出口）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("★ 超窗的 paid_pending 单：人工点一下**能**补发（自动重试已停，这是唯一出口）", async () => {
    // 自动重试窗口用尽之后，没有任何自动路径会再碰它；而它也不会自己好。
    // 人明确点了这一下，就该真的再打一次 billing —— 窗口约束的是无人看管时的预算
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(http.grantBodies).toHaveLength(1);
    expect(result.status).toBe("paid");
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("★ 已标 grant_failed 的单也能人工补发（billing 恢复后人一点就通）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "grant_failed";

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result.status).toBe("paid");
    expect(http.grantBodies).toHaveLength(1);
  });

  it("★ 补发不是「点一下就必成」：仍失败时如实回当前状态，不编一个已到账", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    http.failNextGrants(1);

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result.status).toBe("paid_pending");
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 未支付的单不能补发：从 pending 补发等于无中生有地发积分", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await expect(service.retryGrantForAdmin(created.tradeNo)).rejects.toThrow(/尚未收到款项/);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });

  it("★ 已到账的单不给补发：说清楚「无需重试」，而不是报一个笼统的错", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid";

    await expect(service.retryGrantForAdmin(created.tradeNo)).rejects.toThrow(/已经发放到账/);
  });

  it("单号不存在 → 404", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    await expect(service.retryGrantForAdmin("RC-NOPE")).rejects.toThrow(/订单不存在/);
  });

  it("★ 补发失败**也回读状态**而不是抛错：管理端要记的是每一次尝试", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    http.failNextGrants(1);

    // 抛出去的话，「失败的补发」在操作日志里一条都不会有；而「成功没有」的权威答案
    // 本来就是订单行，不是异常处理。所以：如实回状态，原因进 error 日志
    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result).toEqual({ tradeNo: created.tradeNo, status: "paid_pending" });
  });
});
