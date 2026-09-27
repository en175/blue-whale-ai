/* ============================================
 * 充值：下单 / 查单 / 到账。
 *
 * 链路（我们是收款方，blue-whale-pay 是支付网关，杭州银行是收单行）：
 *
 *   我们 ──统一下单(HCCB_QR)──► 支付网关 ──► 杭州银行统一收银台
 *     ▲                                            │
 *     └──── 异步通知(state=2) ──── 支付网关 ◄──── 用户扫码付款
 *
 * ── 到账为什么是「两把锁」 ────────────────────────────────────────────────────
 *
 * 1. **billing 的幂等键**（`grantKey = purchased:{tradeNo}`）：真正拦重复发放的那道。
 *    进程重启、回调重投、两个请求并发进来，唯一索引都拦得住。
 * 2. **本地订单状态**（`recharge_orders.status`）：记下「这笔走到哪一步了」，
 *    让重复回调不必要地再打一次 billing，也让查单能回答用户。
 *
 * 只留第 1 道：每次重复回调都白打一次 billing（能跑通，但噪音大）。
 * 只留第 2 道：进程在「发放成功 — 写状态」之间挂掉，重试就会**发第二次**——直接的钱损失。
 * 所以两道都要，且本地状态**分两段写**（2026-09-26 起，状态机 4 态扩到 6 态）：
 *
 *   · `paid_pending`（钱到了）写在**发放之前**——发放失败时订单停在这里，
 *     与「用户还没付钱」的 `pending` 区分得开，网关重投也还剩一次重试机会；
 *   · `paid`（积分也发了）写在**发放成功之后**——顺序反了的话，中间挂掉就变成
 *     「标记了已到账而钱没发」，那是最坏的一种不一致（用户付了钱，账上永远没有）。
 *
 * 于是「钱到了没有」的判据是 **`paid_pending` 或 `paid`**（>= 待到账），不再是 `= paid`。
 * 写 `= paid` 的地方会把已经付款、只是还没发成功的单当成没收到钱。
 *
 * ── 到账积分在下单时刻冻结 ────────────────────────────────────────────────────
 *
 * 档位积分配置（以及换算率）都是可改的。用户看着「7,500 积分 · ¥499」点了支付，
 * 之后运营改配置，不能反悔成 800。所以 `credits` 与 `credits_per_yuan` 都写进订单行，
 * 到账按订单里的数发。
 *
 * ⚠️ **档位积分是配置值，不是派生值**（2026-09-27 起，推翻 #41 的派生口径）。
 * 用户下单到账的基础积分直接读 `topup_tiers.base_credits` —— 运营在后台填多少就是多少。
 *
 *   充值的「元 → 积分」与**消费锚点**「1 元 = 15 积分」不是一回事：充值常有折扣。
 *   PRD §6.1 的轻量尝鲜是 ¥499 → **7,500** 积分，而 499 × 15 = 7,485，对不上；
 *   7,500 是「凑整齐」的数，不是算出来的。同理 ¥5,999 → 90,000 积分。
 *
 *   ⚠️ 原价 + 折扣**保留，但只为展示划线价**（¥500 划掉、¥499 实付），
 *   **与积分再无数学关系** —— `credits` 既不是 `原价 × 换算率`，也不是 `实付 × 换算率`。
 *   看到「¥499 划 ¥500，但积分 7,500 不是 500 的倍数」**不要去「修」那个对不上的数**。
 *   `credits_per_yuan` 仍写进订单行，但它现在只回答「下单那一刻的换算率是多少」（对账/客服追溯），
 *   **不参与任何积分计算**：档位到账积分读 `base_credits`（配置值），自定义充值的价格
 *   由配置表自己的 `credits_per_yuan` 反算（见下）。
 *
 * ── 两种商品类型走同一条链路（模块 B）─────────────────────────────────────────
 *
 * `createOrder` 收两种输入：`{tierId}`（固定档位）与 `{credits}`（自定义充值）。
 * **不是两条链路** —— 落库、调网关、回调、到账（`hold` → 发放 → `paid`/`paid_pending`）
 * 全都共用。两种商品只在「这一单是什么、收多少钱、发多少分」这一步分叉，分叉点集中在
 * `buildTierOrderSpec` / `buildCustomOrderSpec` 两个私有方法里，之后合成同一个 `OrderSpec`。
 *
 * 自定义充值的三条口径（产品 2026-09-27 定，别在这里重新发明）：
 *
 *   1. **取整以积分为准**：用户选 N 积分就发 N 积分，价格 = `N ÷ 每元积分数`，
 *      **四舍五入到分**。所以价格会带 ≤ 半分钱的零头，平台承担 —— 账本只有整数积分，
 *      不可能为了把钱凑整去改用户要到账的积分数。
 *   2. **换算率用配置表自己那一份**（`recharge_custom_config.credits_per_yuan`，PRD §7.1
 *      默认 15），不是定价目录里那条**消费锚点**。两者本来就不同：PRD §7.1 自己注明
 *      「与现有展示口径 1 元 = 10 积分不一致，待评审确认」。
 *   3. **`tier_id` 写 NULL**：自定义充值没有档位（迁移 050 把它改成可空）。
 *      编一个 0/1 出来会被按 tier_id 聚合的对账当成真档位。
 *
 * ⚠️ **首购相关的两条刻意没做**（产品的决定，不是遗漏）：
 *   · PRD §7.2 的「购买后将失去首购加赠资格」确认提示；
 *   · PRD §7.4 的「支付成功后该账号视为已首购」。
 *   原因：**首购功能本身还没定形** —— 「每档独立算一次还是每账号只一次」未决（#40 停放中）。
 *   在首购状态怎么算都还没定的时候写「占用资格」，会先冻住一个可能被推翻的口径，
 *   而它一旦落进订单快照（`first_purchase_state`）就改不回来了。
 *   所以自定义充值单的第一购两列仍是默认值（`unknown` / `0` = 不参与加赠），
 *   等 #40 定了再一起补 —— 那时要动的是这里与 `buildCustomOrderSpec`。
 * ============================================ */import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { createLogger, type Logger } from "@lib/core/logging";
import { fetchCreditsPerYuan, grantCredits } from "@lib/shared/billing/billing-admin-client.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import {
  createRechargeOrderRepo,
  RECHARGE_ORDER_STATUS,
  type RechargeOrderListFilter,
  type RechargeOrderPage,
  type RechargeOrderRepo,
  type RechargeOrderStatus,
  type RechargeOrderView,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { buildCustomOrderPlan } from "@lib/shared/recharge-custom/order-spec.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import {
  CASHIER_TOKEN_TTL_MS,
  createActiveOrderReuse,
} from "./recharge-active-order.js";
import { createGrantSweeper, type GrantSweepResult } from "./recharge-grant-sweeper.js";
import {
  PAY_IF_CODE_HCCB,
  PAY_ORDER_STATE,
  PAY_WAY_CODE_HCCB_QR,
  queryOrder,
  unifiedOrder,
  verifyPaySign,
} from "@lib/shared/pay-server/index.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { displayTierName } from "@lib/shared/topup-tier/constants.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";

/**
 * 网关订单有效期 2 小时（下单不带 `expiredTime` 时网关的默认值）。
 *
 * <p>超过这个时间**连网关的单都关了**，不可能再付款成功——所以它是一条无需确认的
 * 过期线：查不到网关时也照样置过期，否则订单会永远 pending、用户端的轮询永远转下去。
 */
const GATEWAY_ORDER_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * 轮询补偿的最小间隔。
 *
 * <p>用户端每 3 秒轮询一次状态；如果每次都顺手问一遍网关，一个用户就是每分钟 20 次查单。
 * 30 秒足够及时（网关自己的补单任务每分钟跑一次），也把量压到 1/10。
 */
const RECONCILE_INTERVAL_MS = 30 * 1000;

/** 档位对用户的样子（到账积分是**档位自己配的基础积分**，与换算率无关）。 */
export interface RechargeTierOffer {
  id: string;
  name: string;
  /**
   * 到账积分 = `topup_tiers.base_credits`（**配置值**）。
   *
   * <p>⚠️ 不是 `原价 × 换算率`。充值常有折扣，¥499 的档给 7,500 积分 ——
   * 那个数不是原价的整数倍，是运营在后台填的（见 `RechargeService` 文件头）。
   */
  amount: number;
  price: number;
  originalPrice: number;
  discount: number;
  isRecommended: boolean;
  sortOrder: number;
}

export interface RechargeCatalog {
  tiers: RechargeTierOffer[];
  /**
   * 1 元 = 多少积分（定价目录的配置项，前端据此渲染换算提示）。
   *
   * <p>⚠️ 它**只是消费侧的锚点口径**，不是档位积分的算法：档位积分读
   * `base_credits`（配置值）。别拿它去乘原价算积分。
   */
  creditsPerYuan: number;
}

export interface RechargeOrderCreated {
  tradeNo: string;
  /** 银行统一收银台链接，前端自己渲染二维码 */
  cashierUrl: string;
  /** 收银台令牌失效时间（ISO 8601） */
  expiresAt: string;
  /** 实付金额（元） */
  amount: number;
  /** 到账积分 */
  credits: number;
}

/** 下单输入·固定档位（模块 A）。 */
export interface CreateTierOrderInput {
  userId: number;
  tierId: string;
}

/**
 * 下单输入·自定义充值（模块 B，PRD §7.3）。
 *
 * <p>`credits` 是**用户要买的积分数**（整数）。价格由服务端按配置反算，
 * **不接受前端传价格** —— 价格是钱，只能由服务端算（PRD §7.5「以服务端最新配置为准」）。
 */
export interface CreateCustomOrderInput {
  userId: number;
  credits: number;
}

/** 下单输入：带 `tierId` = 档位商品，带 `credits` = 自定义充值。两者互斥（判别式联合）。 */
export type CreateRechargeOrderInput = CreateTierOrderInput | CreateCustomOrderInput;

/**
 * 「这一单是什么、收多少钱、发多少分」—— 两种商品类型分叉的**唯一**落点，
 * 之后的落库 / 调网关 / 回调 / 到账全部共用（见文件头）。
 *
 * <p>导出给 `recharge-active-order.ts`（下单防重要拿商品身份去查有没有未支付单）。
 */
export interface OrderSpec {
  /** 档位 ID；自定义充值为 null（迁移 050 起列可空） */
  tierId: number | null;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  productType: "tier" | "custom";
  productName: string;
  configVersion: number;
  /** 赠送积分；不传 = 走 repo 的默认值 0 */
  bonusCredits?: number;
  /** 积分到期时刻；不传 = 走 repo 的默认值 null（永久） */
  creditsExpireAt?: Date | null;
  /** 网关订单标题 / 内容 */
  subject: string;
  body: string;
}

export interface RechargeOrderStateView {
  tradeNo: string;
  status: RechargeOrderStatus;
  /** 到账后的可用积分余额；仅 paid 有值 */
  creditsAfter: number | null;
}

/**

/**
 * 到账积分 = 原价（元）× 换算率，四舍五入到整数积分。
 *
 * <p>⚠️ **现役代码里没有调用方，而且模块 B 落地后仍然没有**（2026-09-27）：
 *   · 档位到账积分读 `topup_tiers.base_credits` 这个**配置值**（充值常有折扣：
 *     ¥499 → 7,500 而不是 7,485）；
 *   · 自定义充值要的是**反算** —— 用户输入「我要 500 积分」折回该付多少钱。
 *     那是 **除**（`customPriceFen` = `credits × 100 ÷ creditsPerYuan`），
 *     不是这个乘。所以它没有被接进模块 B，**这不是漏了**。
 *
 * <p>保留它是因为删除一个已导出的符号是独立决策（要连着它的单测一起动），
 * 而它现在**没有任何生产调用方** —— 谁要清理死代码，从这里开始，别再给它找活干。
 */
export function deriveCredits(originalPrice: number, creditsPerYuan: number): number {
  return Math.round(originalPrice * creditsPerYuan);
}

@Injectable()
export class RechargeService {
  private readonly logger: Logger = createLogger("recharge");
  private repoInstance?: RechargeOrderRepo;
  private reuseInstance?: ReturnType<typeof createActiveOrderReuse>;
  private sweeperInstance?: ReturnType<typeof createGrantSweeper>;

  private get repo(): RechargeOrderRepo {
    if (!this.repoInstance) {
      this.repoInstance = createRechargeOrderRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  /**
   * 下单防重的那一查：该用户这件商品已有未支付单时不建新单（判定见 `recharge-active-order.ts`）。
   * 惰性构造 —— 它要 repo，而 repo 依赖 Prisma 客户端（构造期拿不到）。
   */
  private async reuseActiveOrder(
    userId: number,
    spec: OrderSpec,
  ): Promise<RechargeOrderCreated | null> {
    this.reuseInstance ??= createActiveOrderReuse({
      repo: this.repo,
      reconcile: (order) => this.reconcile(order),
      logger: this.logger,
    });
    return this.reuseInstance(userId, spec);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly topupTier: TopupTierService,
    private readonly settings: SystemSettingsService,
    private readonly custom: RechargeCustomService,
  ) {}

  /* ---------- 档位目录 ---------- */

  async listTiers(): Promise<RechargeCatalog> {
    const creditsPerYuan = await fetchCreditsPerYuan();
    const rows = await this.topupTier.listActive();
    return {
      creditsPerYuan,
      tiers: rows.map((t) => {
        // 到账积分 = 档位自己配的**基础积分**（配置值）。这里**不许**乘换算率：
        // 充值的「元 → 积分」与消费锚点「1 元 = 15 积分」不是一回事（充值常有折扣），
        // ¥499 的档给 7,500 而不是 7,485 —— 那不是算错了，见文件头。
        const amount = t.baseCredits;
        return {
          id: t.id,
          name: displayTierName(t.name, amount),
          amount,
          price: t.price,
          originalPrice: t.originalPrice,
          discount: t.discount,
          isRecommended: t.isRecommended,
          sortOrder: t.sortOrder,
        };
      }),
    };
  }

  /* ---------- 下单 ---------- */

  /**
   * 下单：两种商品类型共用这一条链路（见文件头「两种商品类型走同一条链路」）。
   *
   * <p>输入是判别式联合：带 `tierId` = 固定档位，带 `credits` = 自定义充值。
   * 用 `"tierId" in input` 而不是「先看 credits 有没有」：`tierId` 是**必填**的那一侧，
   * 拿可选字段判类型会让「两个都传」或「两个都没传」落到默认分支上。
   *
   * <p>⚠️ **先看有没有同商品的可复用未支付单**（PRD §7.5「服务端避免重复有效订单」）。
   * 前端 `RechargeModal` 里那个 `if (paying) return` 只拦得住「同一个页面上的连点」——
   * 换个入口、刷新页面、关掉弹窗再打开，请求照样到得了这里，每来一次就是一笔新单 + 一次网关调用。
   */
  async createOrder(input: CreateRechargeOrderInput): Promise<RechargeOrderCreated> {
    const spec =
      "tierId" in input
        ? await this.buildTierOrderSpec(input)
        : await this.buildCustomOrderSpec(input);
    const reused = await this.reuseActiveOrder(input.userId, spec);
    if (reused) return reused;
    return this.placeOrder(input.userId, spec);
  }

  /**
   * 档位单的「这一单是什么、收多少钱、发多少分」。
   *
   * <p>⚠️ **到账积分 = 档位配的基础积分**（配置值），不是「原价 × 换算率」：
   * 充值常有折扣，¥499 的档到账 7,500 积分（499×15=7,485）。原价与折扣只为展示划线价。
   */
  private async buildTierOrderSpec(input: CreateTierOrderInput): Promise<OrderSpec> {
    // 换算率取自定价目录：它**不参与档位积分计算**，只作为「下单那一刻的口径」快照进订单行
    // （对账/客服追溯用）。取不到就说明这个环境的定价目录还没发布 —— 口径都定不下来，
    // 也就谈不上受理一笔充值。见文件头「到账积分在下单时刻冻结」。
    const creditsPerYuan = await fetchCreditsPerYuan();

    const tier = await this.topupTier.getById(input.tierId);
    if (!tier) throw new NewApiError("档位不存在", 404);
    // ⚠️ 草稿与下架都不可买，但话不能说成同一句（PRD §6.3 / §10.5）：
    // 「已下架」说的是一个曾经卖过的东西，而草稿是**还没上过架** ——
    // 对着一张运营刚建好、字段还没配齐的卡片说「已下架」，客服和用户都无从下手。
    if (tier.status !== "active") {
      throw new NewApiError(
        tier.status === "draft" ? "该档位尚未上架" : "该档位已下架",
        400,
      );
    }
    const now = Date.now();
    if (tier.startTime && new Date(tier.startTime).getTime() > now) {
      throw new NewApiError("该档位尚未生效", 400);
    }
    if (tier.endTime && new Date(tier.endTime).getTime() < now) {
      throw new NewApiError("该档位已过期", 400);
    }

    // ⚠️ **到账积分 = 档位配的基础积分**（配置值），不是「原价 × 换算率」：
    //    充值常有折扣，¥499 的档到账 7,500 积分（499×15=7,485）。原价与折扣只为展示划线价。
    const credits = tier.baseCredits;
    const amountFen = Math.round(tier.price * 100);
    if (credits <= 0 || amountFen <= 0) {
      // 到账积分为 0 = 用户付钱拿不到东西。宁可下不了单，也不要产生这种订单
      throw new NewApiError("该档位的金额或积分不合法，请联系客服", 500);
    }

    const tierId = Number(tier.id);
    if (!Number.isSafeInteger(tierId)) {
      throw new NewApiError("档位 ID 不合法", 500);
    }

    return {
      tierId,
      amountFen,
      credits,
      creditsPerYuan,
      productType: "tier",
      productName: displayTierName(tier.name, credits),
      configVersion: tier.version,
      subject: tier.name || "积分充值",
      body: tier.name || `积分充值 ${credits} 积分`,
    };
  }

  /**
   * 自定义充值单的「这一单是什么、收多少钱、发多少分」（模块 B，PRD §7.4 / §7.5）。
   *
   * <p>校验、算价、快照拼装全在 {@link buildCustomOrderPlan}：那里的规则可以脱离
   * Prisma 与网关被直接单测。这里只负责「下单那一刻重新读一次配置」——
   * 用户可能已经在页面上停留很久，期间运营改过上下限或换算率
   * （PRD §7.5「创建订单时以服务端最新配置为准」）。
   */
  private async buildCustomOrderSpec(input: CreateCustomOrderInput): Promise<OrderSpec> {
    return buildCustomOrderPlan(
      await this.custom.requireConfig(),
      input.userId,
      input.credits,
    );
  }

  /**
   * 落库 + 调网关 —— 两种商品类型**共用**的尾段。
   *
   * <p>顺序是固定的：**先落库再调用网关**。网关超时/网络抖动时我们仍然有一条记录可查、
   * 可对账；反过来一旦落库失败，网关那边的成功订单就没有本地对应物。
   */
  private async placeOrder(userId: number, spec: OrderSpec): Promise<RechargeOrderCreated> {
    // 商户配置缺项 → 这里就抛（503），不带着半份配置去下单
    const merchant = await this.settings.requirePayMerchantConfig();

    // 落库时把**商品快照**一起写死（PRD §9.3）：商品名用展示名（用户此刻看到的那串字），
    // 配置版本取配置行此刻的 version（运营之后改价/改名都 +1，据此可判「这单是改价前还是改价后」）。
    // 其余几列（首购、赠送、权限结果）此刻还是常量，取值在 repo 的写入侧一处。
    const tradeNo = generateTradeNo();
    await this.repo.create({
      tradeNo,
      userId,
      tierId: spec.tierId,
      amountFen: spec.amountFen,
      credits: spec.credits,
      creditsPerYuan: spec.creditsPerYuan,
      productType: spec.productType,
      productName: spec.productName,
      configVersion: spec.configVersion,
      ...(spec.bonusCredits !== undefined ? { bonusCredits: spec.bonusCredits } : {}),
      ...(spec.creditsExpireAt !== undefined
        ? { creditsExpireAt: spec.creditsExpireAt }
        : {}),
    });

    const order = await unifiedOrder({
      credentials: merchant,
      mchOrderNo: tradeNo,
      amountFen: spec.amountFen,
      subject: spec.subject,
      body: spec.body,
      notifyUrl: merchant.notifyUrl,
    });

    const bound = await this.repo.bindGatewayOrder(tradeNo, {
      payOrderId: order.payOrderId,
      // 链接要落库（不只是回给前端）：用户再点一次「立即支付」时复用的就是它，
      // 而网关不允许同一个 mchOrderNo 重下一次单，想事后重新要一个是拿不到的
      cashierUrl: order.cashierUrl,
    });    if (!bound) {
      // 不该发生：新单的 pay_order_id 必为空。写不进去只可能是重号或并发，
      // 两种都意味着「这笔订单的网关身份存疑」，要能在日志里看见。
      this.logger.error(
        `订单绑定网关订单号失败 tradeNo=${tradeNo} payOrderId=${order.payOrderId}`,
      );
    }

    return {
      tradeNo,
      cashierUrl: order.cashierUrl,
      // 展示的是**银行收银台令牌**的有效期（30 分钟），不是网关订单的有效期（默认 2 小时）。
      // 用户要关心的是「什么时候扫不了码」，那个期限由银行令牌说了算。
      expiresAt: new Date(Date.now() + CASHIER_TOKEN_TTL_MS).toISOString(),
      // 实付金额与落库/发给网关的 `amountFen` **同源**（不是各自算一遍）：
      // 用户看到的价、我们收的价、事后对账的价，必须永远是一个数
      amount: spec.amountFen / 100,
      credits: spec.credits,
    };
  }

  /* ---------- 管理端：充值记录 ---------- */

  /**
   * 充值记录列表（管理端，offset 分页）。
   *
   * <p>⚠️ **不做归属过滤**：`loadOwnOrder` 那套「这单是不是你的」在这里不适用——
   *    管理端看的就是全部人的单。鉴权由调用方的 `AdminGuard` 承担。
   *
   * <p>分页是 offset（本地表有总数可算）而**不是游标**：与消费记录那边的游标分页
   *    形状不同，但前端的翻页控件是同一个组件，体验一致。
   */
  async listOrdersForAdmin(filter: RechargeOrderListFilter): Promise<RechargeOrderPage> {
    return this.repo.list(filter);
  }

  /* ---------- 查单 ---------- */

  async getOrderStatus(input: {
    userId: number;
    tradeNo: string;
  }): Promise<RechargeOrderStateView> {
    const order = await this.loadOwnOrder(input.userId, input.tradeNo);
    // ⚠️ 两条自愈路径，都由**用户轮询**触发，但做的事不同：
    //   · `pending`      —— 还不知道钱到没到，要**问网关**（reconcile）
    //   · `paid_pending` —— 钱已确认收到、只是积分没发成功，**不必再问网关**，直接补发
    //
    // ⚠️ 第二支不能省。网关重投窗口只有约 15 分钟，过了就没人补发；而用户只要还开着页面
    //    就会一直轮询 —— 少了它，一次发放失败会让用户**永远**停在「发放中」，
    //    比拆状态之前的旧行为还差（那时单留在 `pending`，轮询会经 reconcile 补发）。
    //
    //    补发本身幂等：`fulfill` 先 `markPaidPending`（条件更新，已达则不动作），
    //    发放走 billing 的 `purchased:{tradeNo}` 幂等键，重复调用不会重复发积分。
    //
    // ⚠️ 剩下的缺口（#45 主动对账）：**没人轮询的单**仍然不会自愈 —— 用户关掉页面之后，
    //    重投窗口一过就没人管了。这里补的是「有人在看」的那一半。
    const current =
      order.status === RECHARGE_ORDER_STATUS.pending
        ? await this.reconcile(order)
        : order.status === RECHARGE_ORDER_STATUS.paidPending
          ? await this.retryFulfill(order)
          : order;

    let creditsAfter: number | null = null;
    if (current.status === RECHARGE_ORDER_STATUS.paid) {
      try {
        const balance = await sharedBillingClient().queryBalance(input.userId);
        creditsAfter = balance.availableCredits;
      } catch (error) {
        // 余额查不到**不影响**「这笔到账了没有」这个答案——那是本地订单的事。
        // 前端拿不到 credits_after 会再拉一次余额，比整个查单接口失败要好。
        this.logger.warn(
          `到账后查余额失败 tradeNo=${current.tradeNo}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { tradeNo: current.tradeNo, status: current.status, creditsAfter };
  }

  /**
   * 把一笔 pending 订单往终态推一步：过期判定 + 向网关查单补偿。
   *
   * <p>**回调丢失是必然会发生的**（网关只重投 6 次、约 15 分钟），所以查单补偿不是可选项：
   * 没有它，一次通知失败就变成「用户付了钱、账上永远没有」。
   */
  private async reconcile(order: RechargeOrderView): Promise<RechargeOrderView> {
    const age = Date.now() - Date.parse(order.createdAt);
    if (age > GATEWAY_ORDER_TTL_MS) {
      // 网关的订单也过期了，不可能再付款成功。无需问网关，直接给终态
      await this.repo.markExpired(order.tradeNo);
      return (await this.repo.getByTradeNo(order.tradeNo)) ?? order;
    }

    try {
      if (!(await this.repo.claimQuerySlot(order.tradeNo, RECONCILE_INTERVAL_MS))) {
        return order;
      }
      const merchant = await this.settings.requirePayMerchantConfig();
      const remote = await queryOrder({
        credentials: merchant,
        ...(order.payOrderId
          ? { payOrderId: order.payOrderId }
          : { mchOrderNo: order.tradeNo }),
      });

      if (remote.state === PAY_ORDER_STATE.success) {
        // 与回调同一道闸：查单回来的金额对不上就不发。按 payOrderId 查单时，
        // 万一这个单号不属于本单（绑定写错、网关数据串了），金额是唯一能当场看出来的差异。
        if (remote.amountFen !== null && remote.amountFen !== order.amountFen) {
          this.logger.error(
            `查单金额与订单不符 tradeNo=${order.tradeNo} 订单=${order.amountFen} 网关=${remote.amountFen}`,
          );
        } else {
          await this.fulfill(order);
        }
      } else if (
        remote.state === PAY_ORDER_STATE.failed ||
        remote.state === PAY_ORDER_STATE.revoked ||
        remote.state === PAY_ORDER_STATE.closed
      ) {
        await this.repo.markFailed(order.tradeNo);
      } else if (age > CASHIER_TOKEN_TTL_MS) {
        // 网关也没说成功、银行收银台令牌又过期了 —— 用户已经扫不了码，这笔不会再付款。
        // 给一个明确终态，而不是让他一直盯着「等待支付结果…」
        //
        // ⚠️ 这一步排在「问过网关」之后：钱有没有收，网关比我们的时钟权威。
        //    先按时间置过期、回头网关又说成功，就会先给用户看一次「已过期」再改口成「已到账」。
        await this.repo.markExpired(order.tradeNo);
      }
    } catch (error) {
      // 查单失败（或查到了、但随后的发放失败）都不改变本地状态：现有那条状态就是已知最准的
      // 答案（`paid_pending` 尤其不能往回写）。抛出去只会让用户端连「这笔还没到账」都看不到。
      this.logger.warn(
        `查单补偿失败 tradeNo=${order.tradeNo}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return (await this.repo.getByTradeNo(order.tradeNo)) ?? order;
  }

  /* ---------- 到账（回调） ---------- */

  /**
   * 处理网关的异步通知。
   *
   * @returns 是否已接受（true → 应答 `SUCCESS`，网关停止重投；false → 网关会重投）
   *
   * <p>⚠️ 验签失败、金额对不上、订单不认识，一律**不接受**：
   *    这条接口公网可达，任何一条没验过的报文都可能是伪造的「支付成功」。
   */
  async handleNotify(params: Record<string, string>): Promise<boolean> {
    const merchant = await this.settings.requirePayMerchantConfig();

    if (!verifyPaySign(params, merchant.appSecret)) {
      this.logger.error(`回调验签失败 mchOrderNo=${params.mchOrderNo ?? ""}`);
      return false;
    }
    if (params.ifCode && params.ifCode !== PAY_IF_CODE_HCCB) {
      this.logger.error(`回调渠道不符 ifCode=${params.ifCode}`);
      return false;
    }

    const tradeNo = (params.mchOrderNo ?? "").trim();
    const order = tradeNo ? await this.repo.getByTradeNo(tradeNo) : null;
    if (!order) {
      // 不认识的订单 = 真实的异常（不是重投）：要么单号被人猜着用了，
      // 要么我们的订单行没了。回 success 会把这件事永远盖住。
      this.logger.error(`回调订单不存在 mchOrderNo=${tradeNo}`);
      return false;
    }
    await this.repo.recordNotify(tradeNo);

    // 已到账：重投直接确认，不再打一次 billing。
    // 这条短路是安全的——`paid` 只在**发放成功之后**才写（见 `fulfill`），
    // 所以「本地是 paid」蕴含「积分已经发过」。billing 的幂等键仍留着兜并发与崩溃重试。
    //
    // ⚠️ **只短路 `paid`，不短路 `paid_pending`**：那个状态的意思正是「钱到了、积分还没发成功」。
    //    网关这一投是一次白给的重试机会（重投最多 6 次），短路掉就把它浪费了——
    //    订单从此停在 paid_pending，只能等人来查。所以 paid_pending 要**继续往下走、重试发放**。
    if (order.status === RECHARGE_ORDER_STATUS.paid) {
      return true;
    }

    const state = Number(params.state);
    if (state === PAY_ORDER_STATE.success) {
      const notifiedFen = Number(params.amount);
      if (!Number.isFinite(notifiedFen) || notifiedFen !== order.amountFen) {
        // 金额是资金一致性的最后一道闸：通知金额与订单不符时**绝不发放**。
        // 宁可让网关重投、让人来查，也不能按对方给的数发积分。
        this.logger.error(
          `回调金额与订单不符 tradeNo=${tradeNo} 订单=${order.amountFen} 通知=${params.amount}`,
        );
        return false;
      }
      if (params.wayCode && params.wayCode !== PAY_WAY_CODE_HCCB_QR) {
        this.logger.error(`回调支付方式不符 wayCode=${params.wayCode}`);
        return false;
      }
      try {
        await this.fulfill(order);
        return true;
      } catch (error) {
        // 发放失败 → 不接受，让网关按 30/60/90… 秒重投。订单留在 `paid_pending`
        // （钱到了、积分没发），所以那几次重投是**真的重试发放**，不是白重投。
        // ⚠️ 别指望查单补偿接住它：`reconcile` 只处理 `pending`（见 `getOrderStatus`），
        //    重投窗口（约 15 分钟）过后的补发要等主动对账。
        this.logger.error(
          `到账发放失败 tradeNo=${tradeNo}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      }
    }

    if (
      state === PAY_ORDER_STATE.failed ||
      state === PAY_ORDER_STATE.revoked ||
      state === PAY_ORDER_STATE.closed
    ) {
      await this.repo.markFailed(tradeNo);
      return true;
    }

    // 网关只应通知终态。收到非终态说明契约变了或报文被改了——不吞掉
    this.logger.error(`回调非终态 state=${params.state} tradeNo=${tradeNo}`);
    return false;
  }

  /**
   * 发放积分并把这笔订单记为已到账。
   *
   * <p>三步的顺序固定（见文件头注释）：**先置「钱到了」→ 再发放 → 最后置「积分也发了」**。
   *
   * <p>发放失败时本方法抛错，订单停在 `paid_pending` —— 这正是这个状态存在的理由：
   * 客服看得到「用户付了钱、积分没发」，而不是一条与「还没付钱」不可分辨的 `pending`。
   */
  /**
   * 补发：钱已确认收到、积分没发成功时的重试（由用户轮询触发，见 {@link #getOrderStatus}）。
   *
   * <p>为什么不复用 {@link #reconcile}：那条会**再问一次网关**，而这里的钱已经确认收过了 ——
   * 再问一次既多余，也会把「网关说的算不算数」这套判断重新卷进来（它已经判过一次了）。
   *
   * <p>⚠️ 失败**不抛**：补发失败不该让「查这笔单到哪一步了」这个请求也失败 ——
   * 「发放中」本身就是一个有效且正确的答案。异常记日志，下一次轮询接着试。
   */
  private async retryFulfill(order: RechargeOrderView): Promise<RechargeOrderView> {
    try {
      await this.fulfill(order);
    } catch (error) {
      this.logger.warn(
        `补发失败 tradeNo=${order.tradeNo}（订单停在 ${RECHARGE_ORDER_STATUS.paidPending}，`
          + `用户轮询会继续重试）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    // 重新读一次：成功了要给调用方看 `paid`，失败了要如实回 `paid_pending`
    return this.loadOwnOrder(Number(order.userId), order.tradeNo);
  }

  private async fulfill(order: RechargeOrderView): Promise<void> {
    // 条件更新，重投/并发下只有一个为 true；返回值这里不用——发放与否由调用方按
    // 「状态是否 >= 待到账」判定（`paid_pending` 上的重投要重试发放），不是由它判。
    await this.repo.markPaidPending(order.tradeNo);

    const { lotId, duplicated } = await grantCredits({
      userId: Number(order.userId),
      credits: order.credits,
      // 幂等键用我们自己的交易单号：它先于调用存在，且事后能回答「这积分是从哪来的」
      bizId: order.tradeNo,
    });

    const updated = await this.repo.markPaid({
      tradeNo: order.tradeNo,
      ...(lotId ? { grantLotId: lotId } : {}),
    });
    if (!updated) {
      // 不是错误：并发/重投下另一个请求已经记过了。billing 的幂等键保证只发了一次
      this.logger.warn(
        `订单已到账，本次为重放 tradeNo=${order.tradeNo} duplicated=${duplicated}`,
      );
    }
  }

  /* ---------- 主动对账（定时任务） ---------- */

  /**
   * 扫一轮「钱到了、积分没发完」的单，逐笔再推一次发放。**定时与手动走同一条路径**
   * （`RechargeGrantReconcileTask` 只是这条路的一个计时器，测试与将来的管理端按钮直接调它）。
   *
   * <p>⚠️ 它补的是**没人轮询的那一半**（#45）：`getOrderStatus` 的补发要用户开着页面才触发，
   * 而网关的重投窗口只有约 15 分钟 —— 用户关掉页面之后，一次发放失败的单就再也没有人来碰。
   *
   * <p>规则全文（阈值怎么定的、为什么异常逐笔吞、为什么 `grant_failed` 也在扫描范围内）
   * 在 `recharge-grant-sweeper.ts`；这里只把域内的两件事接进去：订单仓储，与「发放一笔」
   * （`fulfill`，它才是钱路径上那个幂等的实现）。
   */
  async sweepStaleGrants(options: {
    /** 每轮最多处理几笔；不传取扫描器的默认值 */
    batchSize?: number;
    /** 抢名额的间隔（毫秒）：多副本下同一个单多久之内只由一个副本碰 */
    claimMs: number;
  }): Promise<GrantSweepResult> {
    // 惰性构造：扫描器要 repo，而 repo 依赖 Prisma 客户端（构造期拿不到）
    this.sweeperInstance ??= createGrantSweeper({
      repo: this.repo,
      retryGrant: (order) => this.fulfill(order),
      logger: this.logger,
    });
    return this.sweeperInstance(options);
  }

  /* ---------- 私有 ---------- */

  private async loadOwnOrder(userId: number, tradeNo: string): Promise<RechargeOrderView> {
    const order = await this.repo.getByTradeNo(tradeNo);
    // 别人的订单一律当作「不存在」：返回 403 等于确认了这个单号存在
    if (!order || order.userId !== String(userId)) {
      throw new NewApiError("订单不存在", 404);
    }
    return order;
  }
}

/** 商户订单号：可读的时间前缀 + 随机尾，便于客服在网关后台按时间捞单。 */
function generateTradeNo(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `RC${stamp}${randomBytes(4).toString("hex")}`;
}
