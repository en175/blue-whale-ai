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
 * ── 有效期：快照存**月数**，到期时刻在发放那一刻算 ─────────────────────────────
 *
 * 档位（`topup_tiers.credits_valid_months`）与自定义充值（配置表同名列）都可以配有效期，
 * PRD §9.5 的起算点是「**支付成功**时刻」——而下单那一刻根本还没有它（用户可能几十分钟后
 * 才付）。所以：
 *   · 下单时快照的是**月数**（`recharge_orders.credits_valid_months`），不是算好的时刻；
 *   · 发放时（{@link RechargeService.fulfill}）按 `paid_pending_at + 月数` 折出到期时刻，
 *     同一个值**既发给 billing**（显式 `expiresAt`，否则运营配 6 个月会被 billing 的
 *     来源策略按 2 年发）**又写进订单快照**（`credits_expire_at`）。
 * 换算只有一处（`credits-validity.ts`）——两处各算一次就会出现两个到期时间。
 *
 * ── 购买权限：两条路同一个判定 ──────────────────────────────────────────────────
 *
 * `permission` / `permission_allowlist` / `permission_denied_hint` 在档位与自定义充值
 * 配置上都有，判定也必须只有一份（`canPurchaseByPermission`）：各判各的就会出现
 * 「同一批白名单用户在档位能买、在自定义充值买不了」。判定**在下单路径上**发生
 * （不是只在管理端保存时），被拒的用户连单都建不出来。
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
 * ⚠️ **首购加赠的口径已定，但只对档位单生效**：
 *   口径 = 「**每档独立算一次**」（#40 停放期间悬而未决的那条，2026-09-28 定）。
 *   判定与发放都在 `fulfill`（键按 用户+档位 取，见 `grantFirstPurchaseBonus`）。
 *   · 仍**没做**的：PRD §7.2 的「购买后将失去首购加赠资格」确认提示。
 *   · **自定义充值单不参与**：没有档位，也就没有「每档」可言。所以
 *     `buildCustomOrderSpec` 的两列仍是默认值（`unknown` / `0` = 不参与加赠）。
 * ============================================ */import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
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
  type TopupTierRepo,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { buildCustomOrderPlan } from "@lib/shared/recharge-custom/order-spec.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import {
  CASHIER_TOKEN_TTL_MS,
  createActiveOrderReuse,
} from "./recharge-active-order.js";
import { creditsExpireAt } from "./credits-validity.js";
import { buildTierOrderPlan } from "./tier-order-spec.js";
import {
  createGrantSweeper,
  GRANT_RETRY_WINDOW_MS_TOKEN,
  type GrantSweepResult,
} from "./recharge-grant-sweeper.js";
import {
  createGrantWindowWarnGate,
  type GrantWindowWarnGate,
} from "./grant-window-warn.js";
import {
  PAY_IF_CODE_HCCB,
  PAY_ORDER_STATE,
  PAY_WAY_CODE_HCCB_QR,
  queryOrder,
  unifiedOrder,
  verifyPaySign,
} from "@lib/shared/pay-server/index.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import {
  canPurchaseTier,
  displayTierName,
  tierDeniedHint,
} from "@lib/shared/topup-tier/constants.js";
import { TOPUP_TIER_REPO_TOKEN } from "@lib/shared/topup-tier/topup-tier.tokens.js";

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
  /**
   * 当前用户能不能买这一档（PRD §6.3「无权限的档位置灰并展示提示」）。
   *
   * <p>`null` = **未判定**（游客）：价格表是公开信息，游客照样看得到整张目录，
   * 只是不能下单 —— 与自定义充值那条（`can_purchase: null`）同一个口径。
   */
  canPurchase: boolean | null;
  /** 不能买时展示的文案（后台可配，未配则由服务端给默认文案） */
  deniedHint: string;
  /**
   * 这一档到账积分的有效期（月，PRD §9.5 / §10.2）。
   *
   * <p>⚠️ **必须逐档回给前端**（2026-09-27 补）。它此前只在后台可配、只在发放那一刻生效，
   * 目录接口一个字都不说 —— 于是用户侧只能照着写死的一句「积分自到账起 2 年内有效」念。
   * 而一旦运营把某一档配成 6 个月，那句话对**这一档**就是假的（把配置接通之后才成立：
   * 在此之前配了不生效，那句「2 年」倒是碰巧没错）。
   *
   * <p>有效期是**按商品可配**的，页面级写死任何一个数都会再次变成假话：
   * 卡片上标的必须是**这一档自己**的那个数（与自定义充值那条 `credits_valid_months` 对称）。
   */
  creditsValidMonths: number;
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
  /**
   * 本单**应发的**赠送积分快照（首购加赠）；档位不参与首购时为 0。
   *
   * <p>⚠️ 它是「这单挂着多少赠送」的配置快照，**不是最终发放额**：档位参与首购、
   * 但用户已经在这个档位用过赠送时，本列仍是配置值，而实际没发 ——
   * 「到底发没发」由 {@link firstPurchaseState} 回答。两列合起来才讲得清这一单，
   * 缺一个就会把「没资格」误读成「这个档位不送」。
   */
  bonusCredits?: number;
  /**
   * 该档位是否参与首购加赠（配置快照，0 / 1）。
   *
   * <p>下单时快照、发放时读它决定要不要尝试发赠送批次；档位后来改了配置也不回溯。
   */
  firstPurchaseEligible?: number;
  /**
   * 到账积分有效期快照，单位**月**（档位读 `credits_valid_months`，自定义充值读配置）。
   *
   * <p>⚠️ 存月数不存时刻：起算点是**支付成功时刻**（PRD §9.5），下单这一刻还不知道它。
   * 不传 / null = 没有这个快照（存量单），发放时由 billing 按来源策略决定。
   */
  creditsValidMonths?: number | null;
  /**
   * 下单时服务端判定的权限结果快照。
   *
   * <p>⚠️ **落库只可能是 `allowed`**：判定为假时下单路径上已经抛了 403，
   * 被拒的用户**根本建不了单**，这一列不存在第二个取值。
   *
   * <p>所以写入侧写的是**常量**，不是 `allowed ? "allowed" : "denied"` 那样的三元 ——
   * 那个 `denied` 分支不可达，留着它只会让下一个人以为这一列真的有两种取值。
   *
   * <p>这一列现在的意义是「**记下判定发生在哪**」：判定确实在下单路径上发生过
   * （不是别处补写的），结果随这一单一起落库。将来真的出现可落库的第二种结果时，
   * 要改的是这里与 `tier-order-spec.ts` 里那一处，而不是把三元加回来。
   */
  permissionResult?: string;
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

/** 管理端人工补发的结果：补发**之后**回读到的真实状态。 */
export interface RechargeGrantRetryResult {
  tradeNo: string;
  /** `paid` = 这次补发成功；仍是 `paid_pending` / `grant_failed` = 这次没成（原因在日志里） */
  status: RechargeOrderStatus;
}

// ⚠️ 这里曾经有一个 `deriveCredits(原价, 换算率)`（到账积分 = 原价 × 换算率）。
//    它在 2026-09-27 被删掉，因为**两条路都不用它**、而且它的注释在骗人：
//      · 档位到账积分读 `topup_tiers.base_credits` 这个**配置值**（充值常有折扣：
//        ¥499 → 7,500 而不是 499 × 15 = 7,485），不派生；
//      · 自定义充值要的是**反算**（用户输入「我要 500 积分」折回该付多少钱），
//        那是 **除** —— 见 `customPriceFen` = `credits × 100 ÷ creditsPerYuan`。
//    它的注释却写着「留给自定义充值反算」，与模块 B 的实际实现相反，会诱导下一个人
//    真把它接回档位路径（那就把「积分是配置值」这条又推翻一次）。
//    所以删掉它和它的单测：一个没有调用方、注释还反着说的导出符号，留着只有害处。

@Injectable()
export class RechargeService {
  private readonly logger: Logger = createLogger("recharge");
  private repoInstance?: RechargeOrderRepo;
  private reuseInstance?: ReturnType<typeof createActiveOrderReuse>;
  private sweeperInstance?: ReturnType<typeof createGrantSweeper>;
  /** 「补发已超窗」那条 WARN 的频次闸（规则见 `grant-window-warn.ts`） */
  private grantWarnGateInstance?: GrantWindowWarnGate;

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

  /** 「补发已超窗」那条 WARN 的频次闸（为什么要它见 `grant-window-warn.ts`） */
  private get grantWarnGate(): GrantWindowWarnGate {
    this.grantWarnGateInstance ??= createGrantWindowWarnGate();
    return this.grantWarnGateInstance;
  }

  /**
   * @param grantRetryWindowMs 补发重试窗口（毫秒），由装配层注入（见 `RechargeLibModule`）。
   *
   * <p>⚠️ 它**不是本服务自己读 env 得来的**，只有一份来源（`resolveGrantRetryWindowMs`）：
   * 同一个窗口管着两条自愈路径 —— 用户轮询触发的 {@link retryFulfill} 与主动对账的
   * {@link sweepStaleGrants}。服务里再读一遍 env，就会出现「运维把窗口调大了、
   * 而用户轮询那条路仍在 2 小时停」这种只对一条路生效的配置。
   */
  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOPUP_TIER_REPO_TOKEN)
    private readonly topupTier: TopupTierRepo,
    private readonly settings: SystemSettingsService,
    private readonly custom: RechargeCustomService,
    @Inject(GRANT_RETRY_WINDOW_MS_TOKEN)
    private readonly grantRetryWindowMs: number,
  ) {}

  /* ---------- 档位目录 ---------- */

  /**
   * 档位目录（PRD §6.1 价格表）。
   *
   * <p>`userId` 传 null = **游客**：价格表是公开信息，游客照样看得全，
   * 只是 `canPurchase` 为 null（未判定）—— 与自定义充值那条同一个口径
   * （PRD §7.4「游客可见不可买」）。传了 userId 就带上该用户的权限判定，
   * 用户侧据此置灰并展示提示（PRD §6.3）。
   */
  async listTiers(userId: number | null = null): Promise<RechargeCatalog> {
    const creditsPerYuan = await fetchCreditsPerYuan();
    const rows = await this.topupTier.listActive();
    return {
      creditsPerYuan,
      tiers: rows.map((t) => {
        // 到账积分 = 档位自己配的**基础积分**（配置值）。这里**不许**乘换算率：
        // 充值的「元 → 积分」与消费锚点「1 元 = 15 积分」不是一回事（充值常有折扣），
        // ¥499 的档给 7,500 而不是 7,485 —— 那不是算错了，见文件头。
        // ⚠️ 局部名刻意不叫 `amount`：本仓 `amount` 在别处一律指**金额**（元或分），
        //    而这个是积分数。DTO 上的字段名 `amount` 是管理端契约的一部分，不动 ——
        //    所以这里用 `amount: grantedCredits` 显式对上。
        const grantedCredits = t.baseCredits;
        return {
          id: t.id,
          name: displayTierName(t.name, grantedCredits),
          amount: grantedCredits,
          price: t.price,
          originalPrice: t.originalPrice,
          discount: t.discount,
          isRecommended: t.isRecommended,
          sortOrder: t.sortOrder,
          // 与下单路径**同一个判定函数**（`canPurchaseTier`）：两侧各判一次就会
          // 「界面上可点、下单被拒」或者反过来（界面灰着、接口其实放行）
          canPurchase: userId === null ? null : canPurchaseTier(t, userId),
          deniedHint: tierDeniedHint(t),
          // 有效期**逐档**照抄配置：卡片上要标这一档自己的那个数，
          // 页面级那句「N 年内有效」在按商品可配之后必然对某些档是假话
          creditsValidMonths: t.creditsValidMonths,
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
   * <p>校验、算价、快照拼装全在 {@link buildTierOrderPlan}：那里的规则可以脱离 Prisma
   * 与网关被**直接单测**（与自定义充值那侧同形）。这里只负责下单那一刻的两次读 ——
   * 用户可能已经在页面上停留很久，期间档位可能下架、时间窗可能过期、权限名单可能改过。
   */
  private async buildTierOrderSpec(input: CreateTierOrderInput): Promise<OrderSpec> {
    // 换算率取自定价目录：它**不参与档位积分计算**，只作为「下单那一刻的口径」快照进订单行
    // （对账/客服追溯用）。取不到就说明这个环境的定价目录还没发布 —— 口径都定不下来，
    // 也就谈不上受理一笔充值。见文件头「到账积分在下单时刻冻结」。
    const creditsPerYuan = await fetchCreditsPerYuan();

    const tier = await this.topupTier.getById(input.tierId);
    if (!tier) throw new NewApiError("档位不存在", 404);

    return buildTierOrderPlan(tier, creditsPerYuan, input.userId, Date.now());
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
    // 首购加赠的两列（是否参与 / 挂着多少赠送）由 spec 带过来快照，
    // 权限结果与有效期月数同理（那里才是判定发生的地方）；
    // **判定结果**（`first_purchase_state`）不在下单时定 —— 它由发放那一步裁决后回写，
    // 理由见 `grantFirstPurchaseBonus`（两笔未支付单都会自认首单）。
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
      // ⚠️ 这一列**必须真的落库**：发放那一步（`grantFirstPurchaseBonus`）读的是订单快照，
      //    不是当前档位配置。少了它，档位配的首购加赠会在到账时被判成「不参与」而静默不发 ——
      //    正是「配了不生效」那类缺陷的翻版。
      ...(spec.firstPurchaseEligible !== undefined
        ? { firstPurchaseEligible: spec.firstPurchaseEligible }
        : {}),
      // 有效期只存**月数**：到期时刻的起算点是支付成功时刻，下单这一刻算不出来
      // （见 `credits-validity.ts`）
      ...(spec.creditsValidMonths !== undefined
        ? { creditsValidMonths: spec.creditsValidMonths }
        : {}),
      ...(spec.permissionResult !== undefined
        ? { permissionResult: spec.permissionResult }
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
   * <p>分页是 offset（本地表有总数可算）而**不是游标**：与积分记录那边的游标分页
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
    // ⚠️ 三条自愈路径，都由**用户轮询**触发，但做的事不同：
    //   · `pending`      —— 还不知道钱到没到，要**问网关**（reconcile）
    //   · `paid_pending` —— 钱已确认收到、只是积分没发成功，**不必再问网关**，直接补发
    //   · `grant_failed` —— 同上，只是发放反复失败、被对账任务标了出来（见下）
    //
    // ⚠️ 第二支不能省。网关重投窗口只有约 15 分钟，过了就没人补发；而用户只要还开着页面
    //    就会一直轮询 —— 少了它，一次发放失败会让用户**永远**停在「发放中」，
    //    比拆状态之前的旧行为还差（那时单留在 `pending`，轮询会经 reconcile 补发）。
    //
    // ⚠️ **第三支（`grant_failed`）是 2026-09-27 补的**，理由与第二支同源：
    //    它同样是「钱到了、积分没发出去」，只是失败次数多到被标成了异常。
    //    不接这一支的话，用户守着页面也**推不动**一笔异常单 —— 只有扫描器能推，
    //    而扫描器超窗（默认 2 小时）就停了。这与本仓「单子坏了时，两条自愈路径
    //    的行为不该不一样」那条纪律冲突：同一笔单，用户在不在看页面不该决定它能不能被救。
    //    窗口与限流 `retryFulfill` 内部已经有了（超窗就只是如实回状态），不必在这里再判一次。
    //
    //    补发本身幂等：`fulfill` 先 `markPaidPending`（条件更新，已达则不动作），
    //    发放走 billing 的 `purchased:{tradeNo}` 幂等键，重复调用不会重复发积分。
    //
    // ⚠️ 剩下的缺口（#45 主动对账）：**没人轮询的单**仍然不会自愈 —— 用户关掉页面之后，
    //    重投窗口一过就没人管了。这里补的是「有人在看」的那一半。
    const current =
      order.status === RECHARGE_ORDER_STATUS.pending
        ? await this.reconcile(order)
        : order.status === RECHARGE_ORDER_STATUS.paidPending ||
            order.status === RECHARGE_ORDER_STATUS.grantFailed
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
   *
   * <p>⚠️ **窗口 + 限流**（2026-09-27 补）。这条路径是**用户每 3 秒轮询**触发的，
   * 而补发本身是一次真实的 billing 调用。此前它两条都没有：billing 挂掉时，一个开着
   * 充值弹窗的用户每天会打出 2.8 万次注定失败的调用，而且每 3 秒往日志里写一行 ——
   * 「超窗就不再重试」那条规则当时只对定时任务（扫描器）成立。
   *
   * <p>两件事都对齐扫描器那一套（单子坏了的时候，两条自愈路径的行为不该不一样）：
   *   · **限流**用 `claimQuerySlot`，间隔取 {@link RECONCILE_INTERVAL_MS}（30 秒）——
   *     与「查单补偿」同一个名额、同一个间隔。**刻意不用**扫描器的 `GRANT_STALE_AFTER_MS`
   *     （30 分钟）：那是扫描器的「够格重试」下界，套到用户这条路上等于把一次瞬时的
   *     billing 抖动延迟半小时才重试（而用户正盯着「等待支付结果…」）；
   *   · **窗口**用扫描器同一个**可配**值（`grantRetryWindowMs`，默认 2 小时），起点同样是
   *     「钱到的时刻」（`paid_pending_at`）。超窗就不再打 billing，只把**如实的状态**回给前端
   *     （订单仍停在它原来那个状态 —— `paid_pending` 或 `grant_failed`，等主动对账/人工处理），
   *     让界面能说「发放异常」，而不是永远转圈、也不是我们编一个「已到账」。
   *
   * <p>⚠️ 窗口**两条路必须同一个数**（2026-09-27 评审修正）。它此前在这里是硬编码的
   * `GRANT_RETRY_WINDOW_MS`，而扫描器用的是 `readRetryWindowMs(env)` 读出来的可配值 ——
   * 运维按扫描器注释的邀请把 `RECHARGE_GRANT_RETRY_WINDOW_MS` 调大之后，用户轮询这条
   * 仍在 2 小时就停，且下面那条 WARN 会写「超出 120 分钟」，与真实配置不符。
   * 现在只有一份来源（装配层解析后注入），WARN 里的分钟数跟着真实值走。
   *
   * <p>⚠️ 先抢名额**再**判窗口：抢不到名额就不必算窗口（30 秒内已经有谁在管这一笔）。
   * 但**名额不再兼当那条 WARN 的限流**（2026-09-27 修正）：30 秒的名额会让
   * 「补发已超窗」这条 WARN 变成 ≈2880 条/天/副本，比扫描器高两个量级。它现在有自己的
   * 频次闸（`grantWarnGate`，按 tradeNo 去重 + 冷却窗口，见 `grant-window-warn.ts`）。
   */
  private async retryFulfill(order: RechargeOrderView): Promise<RechargeOrderView> {
    // 抢不到名额 = 30 秒内已经有谁（本进程的另一次轮询、扫描器、别的副本）在管这一笔了。
    // 直接回当前状态：不打 billing、也不写日志。
    if (!(await this.repo.claimQuerySlot(order.tradeNo, RECONCILE_INTERVAL_MS))) {
      return order;
    }

    // 起点是「钱到账的时刻」（`paid_pending_at`）；存量行没有那一列就退回下单时刻
    // （与扫描器的 `heldMinutes` 同一口径：宁可在日志里显得久一点，也不要漏判）
    const held = Date.now() - Date.parse(order.paidPendingAt ?? order.createdAt);
    if (held > this.grantRetryWindowMs) {
      // 频次闸：同一条单在冷却窗口内只留一条 WARN。**超窗本身仍然可见** ——
      // 扫描器的聚合 WARN（带 count + 样本）与心跳指标里的 abandoned 每轮都在报，
      // 这里压掉的只是「同一个事实被用户的手速复述」的那部分。
      if (this.grantWarnGate.shouldWarn(order.tradeNo)) {
        this.logger.warn(
          `补发已超出 ${Math.round(this.grantRetryWindowMs / 60_000)} 分钟重试窗口，不再打 billing：`
            + `tradeNo=${order.tradeNo} 已等=${Math.round(held / 60_000)} 分钟`
            + `（订单停在 ${order.status}，等主动对账或人工处理）`,
          { event: "recharge.grant_retry_window_exceeded", trade_no: order.tradeNo },
        );
      }
      // 如实回状态：前端据此显示「发放异常」，而不是我们编一个「已到账」
      return order;
    }

    try {
      await this.fulfill(order);
    } catch (error) {
      this.logger.warn(
        `补发失败 tradeNo=${order.tradeNo}（订单停在 ${order.status}，`
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

    // ── 到期时刻：起算点是**支付成功时刻**（PRD §9.5），不是下单时刻 ──────────────
    //
    // ⚠️ 重读一次订单：`paid_pending_at` 正是上面那一步写进去的，而调用方传进来的 `order`
    //    是**写之前**读的（首次回调时它还是 null）。拿不到就退回「此刻」——
    //    绝不退回下单时刻，那正是这次要修的口径（用户犹豫的那半小时不该从有效期里扣掉）。
    const settled = (await this.repo.getByTradeNo(order.tradeNo)) ?? order;
    const paidAt = new Date(settled.paidPendingAt ?? Date.now());
    // 快照没有月数（本列上线前的存量单）→ 不传，由 billing 按来源策略决定有效期
    const expiresAt =
      settled.creditsValidMonths === null
        ? null
        : creditsExpireAt(paidAt, settled.creditsValidMonths);

    // ⚠️ 只取 `duplicated`：`grantCredits` 回带的 `lotId` 我们**不再落本地**。
    //    批次的权威在 billing，按 `biz_id = 订单号` 就能反查到这一单发了哪几批；
    //    订单表存一份是副本（ADR-0114：每个服务只认自己库里的数据）。
    const { duplicated } = await grantCredits({
      userId: Number(order.userId),
      credits: order.credits,
      // 幂等键用我们自己的交易单号：它先于调用存在，且事后能回答「这积分是从哪来的」
      bizId: order.tradeNo,
      // 显式传到期时刻：运营在档位 / 自定义充值上配的有效期月数**真的生效**了。
      // 不传的话 billing 会按 source=purchased 的默认策略（2 年）发 ——
      // 运营配 6 个月就只是个摆设（这正是评审提的那条：配了不生效）
      ...(expiresAt ? { expiresAt } : {}),
    });

    // ── 首购加赠：**必须在本金之后** ────────────────────────────────────────────
    //
    // 两笔发放不是原子的。顺序反过来的话，进程崩在中间会变成「送了赠品、本金没给」——
    // 而卡在中间时订单仍是 `paid_pending`，下一次回调或对账会重跑本方法：
    // 本金那笔幂等（duplicated），赠送那笔重试。所以「先本金后赠送」不是风格，
    // 是这条重试路径唯一安全的顺序。
    const firstPurchaseState = await this.grantFirstPurchaseBonus(settled, expiresAt);

    const updated = await this.repo.markPaid({
      tradeNo: order.tradeNo,
      // 与发给 billing 的**同一个值**：订单快照记的必须是真实发出去那批积分的到期时刻，
      // 而不是下单时估的另一个数（那两个数必然差一截，快照就成了一句假话）
      ...(expiresAt ? { creditsExpireAt: expiresAt } : {}),
      // 首购加赠的判定结果（只有真判定过才写，见下面 grantFirstPurchaseBonus）
      ...(firstPurchaseState ? { firstPurchaseState } : {}),
    });
    if (!updated) {
      // 不是错误：并发/重投下另一个请求已经记过了。billing 的幂等键保证只发了一次
      this.logger.warn(
        `订单已到账，本次为重放 tradeNo=${order.tradeNo} duplicated=${duplicated}`,
      );
    }
  }

  /**
   * 首购加赠：为**该档位的第一次成功支付**发一批 `bonus` 积分。
   *
   * <h2>为什么判定放在这里，而不是下单时</h2>
   *
   * 判据是「这个用户在这个档位上有没有成功支付过的单」。下单那一刻可能同时存在两笔
   * 同档位的未支付单——两笔都会把自己判成「首单」，这是必然会发生的，不是边缘情况。
   *
   * <h2>闸在哪</h2>
   *
   * 幂等键取 **`bonus:tier:{userId}:{tierId}`**（按用户+档位，不是按订单），
   * 交给 billing 的 `uk_lots__grant_key` 唯一索引去裁决：并发的第二笔必然拿到 409，
   * 也就是 `duplicated: true`。**先到 billing 的那笔赢**，不需要新表、不需要行锁，
   * 也没有任何一条路径能绕过它。
   *
   * <p>代价说清楚：极端并发下赢家是「先到达 billing 的」而不是「先支付的」。
   * 两笔在同一秒内支付时这个差别用户感知不到，换来的是一个不可能被绕过的闸——
   * 值。
   *
   * <h2>⚠️ 一块路牌：seed 049 上那句「停放中」已经过时</h2>
   *
   * `backend/prisma/schema/049_seed_topup_tiers.sql` 的 `first_purchase_eligible` 那一段写着
   * 「发放与否的判定属**模块 C（#40，停放中）**，届时再定」——那是它写下时候的状态，
   * **现在不成立了**：判定与发放就是本方法，口径也已经定成**每档首次**（键见上）。
   * 同段里「档位参与活动 = 展示与赠送口径一致」那句仍然对，过期的只有「停放中」这半句。
   *
   * <p>**为什么不去把原文改掉**：那是**带编号的变更文件**，三份逐字相同
   * （`prisma/schema/049_…` / `prisma/migrations/20260927030000_seed_topup_tiers/` /
   * `docs/sql/20260927_…`），而迁移那份**已经落库** —— 改写会撞 Prisma 的迁移 checksum，
   * `migrate deploy` 直接报漂移。本仓惯例是编号文件只写一次。所以更正在这里，原文留作历史。
   *
   * <p>⚠️ **别顺手再「修」一处**：同文件紧接着那段说「用户端档位目录目前只回
   * name/积分/价格/推荐/排序」—— 字段清单确实不全（{@link #listTiers} 现在还回
   * `originalPrice` / `discount` / `canPurchase` / `deniedHint` / `creditsValidMonths`），
   * **但它的结论仍然成立**：活动标签与按钮文案确实还没接上用户侧。**那段不是过时说明。**
   *
   * <p>这块路牌是必需的，不是洁癖：产品 PRD v0.3.1 §8 抄了种子文件那句，写成
   * 「本模块停放中，本版本不做任何用户侧展示与发放逻辑」—— 与线上实际行为正好相反。
   *
   * @return `first` = 本单是该档位首次、赠送已发（含**重放**：键归本单）｜
   *         `repeat` = 该档位已用过赠送（键归**别的**单）｜
   *         `null` = 没判定出结论：这一单没有首购这回事（档位不参与 / 无赠送额度），
   *                 或撞键但**拿不到归属** —— 后者宁可留 `unknown` 也不猜
   */
  private async grantFirstPurchaseBonus(
    settled: RechargeOrderView,
    expiresAt: Date | null,
  ): Promise<string | null> {
    // 档位不参与首购，或这单根本没挂赠送 → 没有可判定的事，保持 `unknown`
    if (settled.firstPurchaseEligible !== 1 || settled.bonusCredits <= 0) return null;
    // 没有档位的单（自定义充值）不存在「每档首次」这个概念
    if (settled.tierId === null) return null;

    const { duplicated, existingBizId } = await grantCredits({
      userId: Number(settled.userId),
      credits: settled.bonusCredits,
      source: "bonus",
      // bizId 仍用本单号：它是这批赠送的**来路**（谁触发的），事后要能回答
      bizId: settled.tradeNo,
      // ⚠️ 幂等键才是「首购」的判据所在，与 bizId 是两回事：
      //    bizId 回答「这分从哪来」，grantKey 回答「什么时候只能发一次」。
      grantKey: `bonus:tier:${settled.userId}:${settled.tierId}`,
      // 有效期与本金**同一个值**：档位卡片对用户写的就是那几个月，赠送批次突然
      // 换个更短的有效期而界面从没说过，只会变成客服工单。
      ...(expiresAt ? { expiresAt } : {}),
    });

    if (!duplicated) return "first";

    // ⚠️ **撞键 ≠ 这一单没发。** 键是按「用户+档位」取的，所以它很可能正是**本单**
    //    上一次尝试留下的：发放成功、进程在写订单状态之前死掉，于是网关重投 / 对账 /
    //    人工补发会把 `fulfill` 再跑一遍，两笔发放都撞回 409。
    //    此时写成 `repeat` 就是对「确实发出了赠送的那一单」撒谎 —— 而这列将来是要被
    //    用来回答「这个用户到底拿到赠送没有」的。
    //
    //    分辨只能靠归属：键归本单 → 是重放，仍然 `first`；归别人 → 才是真的重复购买。
    if (existingBizId === null) {
      // 拿不到归属（老版本 billing 不带该字段，或撞的是别的唯一索引）：如实记「不知道」。
      // 宁可让这一列停在 `unknown`，也不要写一个我们并不掌握的结论。
      this.logger.warn(
        `首购赠送撞键但拿不到归属，状态保持未判定 tradeNo=${settled.tradeNo}`,
      );
      return null;
    }
    return existingBizId === settled.tradeNo ? "first" : "repeat";
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
    /**
     * 重试窗口（毫秒）：从「钱到账的时刻」起算，超窗的单不再重试（只为可见性统计）。
     * 不传取本服务注入的那个窗口 —— 与用户轮询那条路（{@link retryFulfill}）**同一个数**，
     * 两条自愈路径不可能各用各的窗口。规则全文见 `recharge-grant-sweeper.ts`。
     */
    retryWindowMs?: number;
  }): Promise<GrantSweepResult> {
    // 惰性构造：扫描器要 repo，而 repo 依赖 Prisma 客户端（构造期拿不到）
    this.sweeperInstance ??= createGrantSweeper({
      repo: this.repo,
      retryGrant: (order) => this.fulfill(order),
      logger: this.logger,
    });
    return this.sweeperInstance({
      ...options,
      retryWindowMs: options.retryWindowMs ?? this.grantRetryWindowMs,
    });
  }

  /* ---------- 管理端：人工补发 ---------- */

  /**
   * 管理端「重试发放」：对一笔**钱已收、积分没发出去**的单，人工再推一次发放。
   *
   * <p>── 为什么需要它（E-1 的第三条）────────────────────────────────────────────
   *
   * 到账的三条自动路径都有边界：网关只重投约 15 分钟、用户轮询只在用户开着页面时发生、
   * 扫描器**超窗（2 小时）之后就不再重试**。三条都用尽之后，那笔单在库里看起来只是
   * 「卡住」—— 没有任何一个状态叫「放弃」，也没有任何动作能再推它一次，只能等人。
   * 而人此前**没有任何入口**：管理端那一页只有只读列表。
   *
   * <p>⚠️ 它**刻意越过重试窗口**。窗口约束的是**无人看管**时的自动重试预算
   * （一个永久坏单每 5 分钟打一次 billing、没有出口）；这里是一次**有人明确决定**的重试，
   * 前提就是「人已经判断过这笔该再试一次」。窗口在这里不是保护，是障碍。
   *
   * <p>⚠️ 它**不抢 `claimQuerySlot` 名额**：那个名额是为了避免「多副本重复做同一件事」，
   * 而人工点击本来就是一次独立决定 —— 抢不到名额就回一句「稍后再试」等于让操作员
   * 对着一个没有任何提示的按钮反复点。重复发放仍然安全：`fulfill` 走 billing 的
   * `purchased:{tradeNo}` 幂等键，多发一次不会多给积分。
   *
   * <p>⚠️ 发放失败**不回错误码，而是如实回读到的状态**（`paid_pending` / `grant_failed`）。
   * 两个理由：
   *   · 「这次点成功了没有」的权威答案**是订单行本身**，不是我们的异常处理 ——
   *     发放过程中任何一步失败都可能钱已经动了，报「失败」比报「状态还是 X」更容易骗人；
   *   · 管理端的审计要记的是**每一次尝试**（含没成的那些），抛出去就等于
   *     「失败的补发在操作日志里一条都没有」。
   * 失败原因写进 error 日志（带单号），排查时按单号捞。
   */
  async retryGrantForAdmin(tradeNo: string): Promise<RechargeGrantRetryResult> {
    const order = await this.repo.getByTradeNo(tradeNo);
    if (!order) throw new NewApiError("订单不存在", 404);

    // ⚠️ 只认「钱到了、积分没发出去」这两种状态。从 `pending` 补发等于把「用户还没付钱」
    //    当成到账异常处理 —— 那是无中生有地发积分。
    if (
      order.status !== RECHARGE_ORDER_STATUS.paidPending &&
      order.status !== RECHARGE_ORDER_STATUS.grantFailed
    ) {
      throw new NewApiError(
        order.status === RECHARGE_ORDER_STATUS.paid
          ? "该订单的积分已经发放到账，无需重试"
          : `该订单尚未收到款项（当前状态：${order.status}），不能补发`,
        400,
      );
    }

    try {
      await this.fulfill(order);
    } catch (error) {
      // 不抛出：调用方要的是「现在到底怎么样了」，下面回读给他
      this.logger.error(
        `人工补发失败 tradeNo=${tradeNo}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // 回过读后的**真实**状态（不是「我以为成功了」）：fulfill 幂等命中或并发下，
    // 订单可能已经被别人推到 paid，回读拿到的是那个答案
    const after = await this.repo.getByTradeNo(tradeNo);
    return { tradeNo, status: after?.status ?? order.status };
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
