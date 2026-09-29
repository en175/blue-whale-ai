import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsService,
} from "@lib/shared/system-settings/index.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import { stubTierRepo } from "@lib/shared/topup-tier/topup-tier.testlib.js";
import {
  APP_SECRET,
  NOTIFY_URL,
  makeHttp,
  makePrisma,
  makeService,
  notifyParams,
  signed,
} from "./recharge.testlib.js";
import { creditsExpireAt } from "./credits-validity.js";
import { buildCustomOrderPlan } from "@lib/shared/recharge-custom/order-spec.js";
import { GRANT_RETRY_WINDOW_MS } from "./recharge-grant-sweeper.js";
import { RechargeService } from "./recharge.service.js";
/* ============================================
 * 自定义充值下单（模块 B，PRD §7）：从「用户点了买 N 积分」到「订单落库 + 交给网关」。
 *
 * ⚠️ 这一组用例**不装定价目录的 gRPC 桩**（`grpcActiveCatalog`）：自定义充值的价格用
 *    配置表自己那条换算率（`recharge_custom_config.credits_per_yuan`），**不读消费锚点**。
 *    装了反而是把「不依赖目录」这件事测没。
 *
 * 夹具与档位/回调用例共用一套（`recharge.testlib.ts`）—— 到账那条链路两种商品是**同一个**，
 * 各自搭一份假库就会各自漏一处。
 * ============================================ */

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});


describe("RechargeService — 自定义充值下单（模块 B，PRD §7）", () => {
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

  /**
   * ⚠️ 自定义充值**不看定价目录**（`fetchCreditsPerYuan`）：它用配置表自己那条换算率
   * （PRD §7.1「与现有展示口径 1 元 = 10 积分不一致」）。
   * 所以这些用例**不装 gRPC 目录桩** —— 装了反而是把「不依赖目录」这件事测没。
   */
  it("★ 默认 600 积分 = ¥40，订单快照按 PRD §7.4/§9.3 写全，且 tier_id 为 NULL", async () => {
    makeHttp();
    const { service, orders } = await makeService();

    const created = await service.createOrder({ userId: 9001, credits: 600 });

    // PRD §7.6「默认值」：600 积分 → ¥40（600 ÷ 15 = 40，整元）
    expect(created.amount).toBe(40);
    expect(created.credits).toBe(600);

    const order = orders.get(created.tradeNo);
    expect(order?.amount_fen).toBe(4_000n);
    expect(order?.credits).toBe(600n);
    // 快照四项（§7.4「记录积分数量、换算比例、价格、有效期」）
    expect(order?.credits_per_yuan).toBe(15);
    expect(order?.config_version).toBe(5);
    // ⚠️ 有效期快照的是**月数**（配置表里那个数），不是算好的时刻：起算点是支付成功
    // 时刻（§9.5），下单这一刻还不知道它 —— 到期时刻由发放那一步按钱到的时刻折出来
    expect(order?.credits_valid_months).toBe(24);
    expect(order?.credits_expire_at).toBeNull();
    // 商品类型与名称快照（§9.3「商品类型：自定义充值」「商品名称：自定义充值」）
    expect(order?.product_type).toBe("custom");
    expect(order?.product_name).toBe("自定义充值");
    // ⚠️ 自定义充值**没有档位**：NULL，不是 0/1（编出来的数会被按 tier_id 聚合的对账当成真档位）
    expect(order?.tier_id).toBeNull();
    // §7.1「第一版默认不对自定义充值发放首购赠送积分」
    expect(order?.bonus_credits).toBe(0n);
    // ⚠️ 权限结果与档位那条**同一个口径**（M-3）：它是判出来的 allowed，不是 repo 的
    // 默认常量。此前只有档位那条传真值，同一列在两条购买路径上口径不同
    expect(order?.permission_result).toBe("allowed");
  });

  it("★ 价格按 1 元 = 15 积分刷新：900 积分 = ¥60，6000 积分 = ¥400", async () => {
    makeHttp();
    const { service, orders } = await makeService();

    const a = await service.createOrder({ userId: 9001, credits: 900 });
    const b = await service.createOrder({ userId: 9001, credits: 6000 });

    expect(a.amount).toBe(60);
    expect(b.amount).toBe(400);
    expect(orders.get(a.tradeNo)?.amount_fen).toBe(6_000n);
    expect(orders.get(b.tradeNo)?.amount_fen).toBe(40_000n);
  });

  it("★ 取整以积分为准：价格四舍五入到分，到账积分仍是用户要的那个整数", async () => {
    makeHttp();
    // 615 ÷ 15 = 41，整元；换成每元 7 积分时 616 ÷ 7 = 88 元整。
    // 这里要钉的是「半分钱零头由平台承担，绝不动到账积分」：
    // 601 ÷ 15 = 40.0666… → ¥40.07（4007 分），到账仍是 601 积分
    const { service, orders, setCustomConfig } = await makeService();
    setCustomConfig({ min_credits: BigInt(1), default_credits: BigInt(1), step_credits: BigInt(1) });

    const created = await service.createOrder({ userId: 9001, credits: 601 });

    expect(orders.get(created.tradeNo)?.amount_fen).toBe(4_007n);
    expect(created.credits).toBe(601);
    // 价格是「分」的整数倍（能被支付网关收），不是 40.0666…
    expect(created.amount).toBe(40.07);
  });

  it("★ 低于最低 / 高于最高 → 拒绝，不建单（PRD §7.6「范围校验」）", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();

    await expect(service.createOrder({ userId: 9001, credits: 599 })).rejects.toThrow(
      /须在 600 ~ 499995 之间/,
    );
    await expect(
      service.createOrder({ userId: 9001, credits: 500_000 }),
    ).rejects.toThrow(/须在 600 ~ 499995 之间/);

    // 一笔都没落库、一次网关都没调 —— 「拒绝」必须是**什么都没发生**
    expect(orders.size).toBe(0);
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);
  });

  it("★ 不在步长格点上 → 拒绝（滑杆与手输的约束不能被构造请求绕过）", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();

    await expect(service.createOrder({ userId: 9001, credits: 601 })).rejects.toThrow(
      /须为 15 的整数倍/,
    );
    expect(orders.size).toBe(0);
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);
  });

  it("★ 非整数 / 0 / 负数 / 非数字 → 全部拒绝", async () => {
    makeHttp();
    const { service } = await makeService();

    for (const credits of [0, -15, 600.5, Number.NaN, "abc", null] as unknown[]) {
      await expect(
        service.createOrder({ userId: 9001, credits: credits as number }),
      ).rejects.toThrow(/1 以上的整数/);
    }
  });

  it("★ 自定义充值停用（enabled=0）→ 拒绝下单", async () => {
    makeHttp();
    const { service, orders, setCustomConfig } = await makeService();
    setCustomConfig({ enabled: 0 });

    await expect(service.createOrder({ userId: 9001, credits: 600 })).rejects.toThrow(
      /暂未开放/,
    );
    expect(orders.size).toBe(0);
  });

  it("★ 白名单权限：不在名单里 → 403 且带后台配的提示；在名单里 → 正常下单", async () => {
    makeHttp();
    const { service, orders, setCustomConfig } = await makeService();
    setCustomConfig({
      permission: "user_group",
      permission_allowlist: ["9001"],
      permission_denied_hint: "该活动仅限内测用户",
    });

    await expect(service.createOrder({ userId: 7007, credits: 600 })).rejects.toThrow(
      /该活动仅限内测用户/,
    );
    // 拒绝 = 不建单（PRD §7.5「用户无购买权限 → 展示提示，不创建订单」）
    expect(orders.size).toBe(0);

    const created = await service.createOrder({ userId: 9001, credits: 600 });
    expect(created.credits).toBe(600);
  });

  it("★ 没配提示文案时用默认文案（不能把空串当提示展示）", async () => {
    makeHttp();
    const { service, setCustomConfig } = await makeService();
    setCustomConfig({ permission: "user_group", permission_allowlist: [] });

    await expect(service.createOrder({ userId: 9001, credits: 600 })).rejects.toThrow(
      /暂不可购买自定义充值/,
    );
  });

  it("★ member_tier 权限本阶段**只是占位**：不拦人（PRD §10.4 阶段 2 生效）", async () => {
    makeHttp();
    const { service, setCustomConfig } = await makeService();
    setCustomConfig({ permission: "member_tier", permission_allowlist: null });

    // 会员体系还没有，按它拒绝等于把所有人都挡在门外，且现场表现是
    // 「配置看着没问题、人人都买不了」—— 那比「暂时不生效」难查得多
    const created = await service.createOrder({ userId: 9001, credits: 600 });
    expect(created.credits).toBe(600);
  });

  it("★ 配置变更只影响新订单：已下单的积分与价格被冻结（PRD §7.4「配置变更」）", async () => {
    makeHttp();
    const { service, orders, setCustomConfig } = await makeService();

    const before = await service.createOrder({ userId: 9001, credits: 600 });
    // ⚠️ 第一笔要先离开 `pending`：下单防重（PRD §7.5）会把「同一商品 + 同一用户 + 尚未支付」
    //    的第二次下单复用成同一笔，那样就没有第二单可比价格了（用户付完再买才是真实路径）
    orders.get(before.tradeNo)!.status = "paid";
    // 运营把换算率从 15 改成 5（600 积分从 ¥40 变成 ¥120）
    setCustomConfig({ credits_per_yuan: 5 });
    const after = await service.createOrder({ userId: 9001, credits: 600 });

    expect(orders.get(before.tradeNo)?.amount_fen).toBe(4_000n);
    expect(orders.get(before.tradeNo)?.credits_per_yuan).toBe(15);
    expect(orders.get(after.tradeNo)?.amount_fen).toBe(12_000n);
    expect(orders.get(after.tradeNo)?.credits_per_yuan).toBe(5);
  });

  it("★ 下单时以服务端最新配置为准：前端传的价格字段被忽略（PRD §7.5）", async () => {
    const http = makeHttp();
    const { service } = await makeService();

    // 调用方多塞一个 amount/price 也没有用：`createOrder` 的输入里根本没有价格这一项
    const created = await service.createOrder({
      userId: 9001,
      credits: 600,
      amount: 0.01,
      price: 0.01,
    } as never);

    expect(created.amount).toBe(40);
    const unified = http.calls.find((c) => c.url.endsWith("/api/pay/unifiedOrder"));
    expect(unified?.body.amount).toBe(4_000);
  });

  it("★ 配置行缺失 → 503（不回退到代码里的默认值：那会让「配了多少」有两个答案）", async () => {
    makeHttp();
    const { prisma, orders } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: APP_SECRET,
        hccb_notify_url: NOTIFY_URL,
      },
    });
    const service = new RechargeService(
      { client: prisma } as never,
      stubTierRepo({ listActive: async () => [], getById: async () => null }),
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 9001, credits: 600 })).rejects.toThrow(
      /配置缺失/,
    );
    expect(orders.size).toBe(0);
  });

  it("★ 自定义充值单**复用同一条到账链路**：回调按订单积分发放，不额外发首购赠送", async () => {
    makeHttp();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, credits: 1200 });

    await service.handleNotify(
      await signed(
        notifyParams(created.tradeNo, {
          amount: String(orders.get(created.tradeNo)?.amount_fen),
        }),
      ),
    );

    // 状态机两步（先「钱到了」后「积分也发了」），与档位单完全一致
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
    const order = orders.get(created.tradeNo);
    expect(order?.status).toBe("paid");
    // 到账积分 = 订单里的积分（§9.4「自定义充值：发放用户购买的积分数量」）
    expect(order?.credits).toBe(1200n);
    // 赠送恒 0：§7.1「第一版默认不对自定义充值发放首购赠送积分」
    expect(order?.bonus_credits).toBe(0n);
    // 首购两列仍是默认值 —— 「占用首购资格」刻意没做，理由见 recharge.service.ts 文件头
    expect(order?.first_purchase_state).toBe("unknown");
    expect(order?.first_purchase_eligible).toBe(0);
  });

  it("★ 自定义充值的有效期也真的生效：按支付成功时刻 + 配置月数算，与档位单同一条口径", async () => {
    const http = makeHttp();
    const { service, orders, setCustomConfig } = await makeService();
    setCustomConfig({ credits_valid_months: 6 });
    const created = await service.createOrder({ userId: 9001, credits: 600 });

    await service.handleNotify(
      await signed(
        notifyParams(created.tradeNo, {
          amount: String(orders.get(created.tradeNo)?.amount_fen),
        }),
      ),
    );

    const row = orders.get(created.tradeNo);
    const paidAt = row?.paid_pending_at as Date;
    const expected = creditsExpireAt(paidAt, 6);
    expect(row?.credits_expire_at).toEqual(expected);
    expect(http.grantBodies[0]?.expiresAt).toBe(expected.toISOString());
  });
});

describe("buildCustomOrderPlan — 权限结果快照（M-3）", () => {
  /**
   * ⚠️ 为什么单独钉在**纯函数**这一层：`RECHARGE_ORDER_SNAPSHOT_DEFAULTS.permissionResult`
   * 恰好也是 `allowed`，所以「落库那一列是 allowed」这条断言在**没接上判定**时同样是绿的。
   * 真正要钉的是「这个字段由 plan 给出」，而不是留给 repo 的默认常量 ——
   * 这一列回答的是「这单当时到底判过权限没有」，写死常量就是一句假话。
   */
  const baseConfig = {
    enabled: true,
    minCredits: 600,
    maxCredits: 499_995,
    defaultCredits: 600,
    stepCredits: 15,
    creditsPerYuan: 15,
    creditsValidMonths: 24,
    permission: "all",
    permissionAllowlist: [],
    permissionDeniedHint: "",
    version: 5,
  } as unknown as Parameters<typeof buildCustomOrderPlan>[0];

  it("★ plan 自己带上判定结果（不是留给 repo 的默认常量）", () => {
    const plan = buildCustomOrderPlan(baseConfig, 9001, 600);
    expect(plan.permissionResult).toBe("allowed");
    // 键**存在**才算带上了：`undefined` 会被 repo 兜成默认值，
    // 于是「判定过没有」这个问题又回到答不上来的状态
    expect(Object.keys(plan)).toContain("permissionResult");
  });

  it("白名单外的用户根本建不出单（所以落库的值只可能是 allowed，见 plan 注释）", () => {
    const restricted = {
      ...baseConfig,
      permission: "user_group",
      permissionAllowlist: ["9001"],
    } as Parameters<typeof buildCustomOrderPlan>[0];

    expect(() => buildCustomOrderPlan(restricted, 7007, 600)).toThrow(/暂不可购买/);
    expect(buildCustomOrderPlan(restricted, 9001, 600).permissionResult).toBe("allowed");
  });
});
