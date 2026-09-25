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
 * 2. **本地订单状态**（`recharge_orders.status`）：记下「这笔已经发过了」，
 *    让重复回调不必要地再打一次 billing，也让查单能回答用户。
 *
 * 只留第 1 道：每次重复回调都白打一次 billing（能跑通，但噪音大）。
 * 只留第 2 道：进程在「发放成功 — 写状态」之间挂掉，重试就会**发第二次**——直接的钱损失。
 * 所以两道都要，且顺序是「先发放、后改状态」：先写状态的话，中间挂掉就变成「标记了已到账
 * 而钱没发」，那是最坏的一种不一致（用户付了钱，账上永远没有）。
 *
 * ── 到账积分在下单时刻冻结 ────────────────────────────────────────────────────
 *
 * 换算率是定价目录的配置项、可改。用户看着「1000 积分 · ¥100」点了支付，之后运营改口径，
 * 不能反悔成 800。所以 `credits` 与 `credits_per_yuan` 都写进订单行，到账按订单里的数发。
 *
 * 积分按**档位原价**算（不是实付价）：折扣是让利——少收钱、不少给积分。
 * 按实付算的话，用户看到的「原价划线 + 折扣」会变成一个自相矛盾的界面
 * （打了折反而积分更少），且现有档位口径本来就是「到账积分由原价派生」。
 * ============================================ */
import { randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { createLogger, type Logger } from "@lib/core/logging";
import {
  BillingAdminConfigError,
  BillingAdminError,
  fetchCreditsPerYuan,
  grantCredits,
} from "@lib/shared/billing/billing-admin-client.js";
import { sharedBillingClient, toBillingError } from "@lib/shared/billing/billing-client.js";
import {
  createRechargeOrderRepo,
  type RechargeOrderRepo,
  type RechargeOrderStatus,
  type RechargeOrderView,
} from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import {
  PayGatewayError,
  PayServerConfigError,
  PAY_IF_CODE_HCCB,
  PAY_ORDER_STATE,
  PAY_WAY_CODE_HCCB_QR,
  queryOrder,
  unifiedOrder,
  verifyPaySign,
} from "@lib/shared/pay-server/index.js";
import { SystemSettingsConfigError } from "@lib/shared/system-settings/credentials-crypto.js";
import { SystemSettingsService } from "@lib/shared/system-settings/system-settings.service.js";
import { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";

/** 银行统一收银台令牌有效期 30 分钟（实测 `tokenBegin`~`tokenEnd`）。 */
const CASHIER_TOKEN_TTL_MS = 30 * 60 * 1000;

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

/** 档位对用户的样子（到账积分是**按当前换算率算出的展示值**，与下单时冻结的是同一个数）。 */
export interface RechargeTierOffer {
  id: string;
  name: string;
  amount: number;
  price: number;
  originalPrice: number;
  discount: number;
  isRecommended: boolean;
  sortOrder: number;
}

export interface RechargeCatalog {
  tiers: RechargeTierOffer[];
  /** 1 元 = 多少积分（定价目录的配置项，前端据此渲染换算提示） */
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

export interface RechargeOrderStateView {
  tradeNo: string;
  status: RechargeOrderStatus;
  /** 到账后的可用积分余额；仅 paid 有值 */
  creditsAfter: number | null;
}

/** 到账积分 = 原价（元）× 换算率。四舍五入到整数积分（账本只有整数积分）。 */
export function deriveCredits(originalPrice: number, creditsPerYuan: number): number {
  return Math.round(originalPrice * creditsPerYuan);
}

@Injectable()
export class RechargeService {
  private readonly logger: Logger = createLogger("recharge");
  private repoInstance?: RechargeOrderRepo;

  private get repo(): RechargeOrderRepo {
    if (!this.repoInstance) {
      this.repoInstance = createRechargeOrderRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly topupTier: TopupTierService,
    private readonly settings: SystemSettingsService,
  ) {}

  /* ---------- 档位目录 ---------- */

  async listTiers(): Promise<RechargeCatalog> {
    const creditsPerYuan = await fetchCreditsPerYuan();
    const rows = await this.topupTier.listActive();
    return {
      creditsPerYuan,
      tiers: rows.map((t) => ({
        id: t.id,
        name: t.name,
        amount: deriveCredits(t.originalPrice, creditsPerYuan),
        price: t.price,
        originalPrice: t.originalPrice,
        discount: t.discount,
        isRecommended: t.isRecommended,
        sortOrder: t.sortOrder,
      })),
    };
  }

  /* ---------- 下单 ---------- */

  async createOrder(input: {
    userId: number;
    tierId: string;
  }): Promise<RechargeOrderCreated> {
    // 换算率取自定价目录；取不到就报不出价，也就谈不上给用户承诺多少积分
    const creditsPerYuan = await fetchCreditsPerYuan();

    const tier = await this.topupTier.getById(input.tierId);
    if (!tier) throw new NewApiError("档位不存在", 404);
    if (tier.status !== "active") throw new NewApiError("该档位已下架", 400);
    const now = Date.now();
    if (tier.startTime && new Date(tier.startTime).getTime() > now) {
      throw new NewApiError("该档位尚未生效", 400);
    }
    if (tier.endTime && new Date(tier.endTime).getTime() < now) {
      throw new NewApiError("该档位已过期", 400);
    }

    const credits = deriveCredits(tier.originalPrice, creditsPerYuan);
    const amountFen = Math.round(tier.price * 100);
    if (credits <= 0 || amountFen <= 0) {
      // 到账积分为 0 = 用户付钱拿不到东西。宁可下不了单，也不要产生这种订单
      throw new NewApiError("该档位的金额或积分不合法，请联系客服", 500);
    }

    const tierId = Number(tier.id);
    if (!Number.isSafeInteger(tierId)) {
      throw new NewApiError("档位 ID 不合法", 500);
    }

    // 商户配置缺项 → 这里就抛（503），不带着半份配置去下单
    const merchant = await this.settings.requirePayMerchantConfig();

    // 先落库再调用网关：网关超时/网络抖动时我们仍然有一条记录可查、可对账；
    // 反过来（先调用后落库）一旦落库失败，网关那边的成功订单就没有本地对应物。
    const tradeNo = generateTradeNo();
    await this.repo.create({
      tradeNo,
      userId: input.userId,
      tierId,
      amountFen,
      credits,
      creditsPerYuan,
    });

    const order = await unifiedOrder({
      credentials: merchant,
      mchOrderNo: tradeNo,
      amountFen,
      subject: tier.name || "积分充值",
      body: tier.name || `积分充值 ${credits} 积分`,
      notifyUrl: merchant.notifyUrl,
    });

    const bound = await this.repo.bindPayOrderId(tradeNo, order.payOrderId);
    if (!bound) {
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
      amount: tier.price,
      credits,
    };
  }

  /* ---------- 查单 ---------- */

  async getOrderStatus(input: {
    userId: number;
    tradeNo: string;
  }): Promise<RechargeOrderStateView> {
    const order = await this.loadOwnOrder(input.userId, input.tradeNo);
    const current = order.status === "pending" ? await this.reconcile(order) : order;

    let creditsAfter: number | null = null;
    if (current.status === "paid") {
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
      // 查单失败不改变本地状态：网关抖动或配置缺失时，本地那条「pending」仍是已知最准的答案。
      // 抛出去只会让用户端连「这笔还没到账」都看不到。
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
    // 这条短路是安全的——`markPaid` 只在**发放成功之后**才写（见 `fulfill`），
    // 所以「本地是 paid」蕴含「积分已经发过」。billing 的幂等键仍留着兜并发与崩溃重试。
    if (order.status === "paid") {
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
        // 发放失败 → 不接受，让网关按 30/60/90… 秒重投；
        // 重投窗口过了还有查单补偿（`reconcile`）兜底。
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
   * <p>顺序不可颠倒（见文件头注释）：**先发放、后改状态**。
   */
  private async fulfill(order: RechargeOrderView): Promise<void> {
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

/**
 * 充值域错误 → HTTP 信封错误。
 *
 * <p>三类分开：**配置错了**（503，要人改配置）、**网关业务失败**（502，可重试或换金额）、
 * **billing 不可用**（503）。统一成 500 会让「少配一个环境变量」看起来像「服务挂了」，
 * 处置完全不同。
 */
export function toRechargeError(error: unknown, fallbackMessage: string): NewApiError {
  if (error instanceof NewApiError) return error;
  if (
    error instanceof PayServerConfigError ||
    error instanceof BillingAdminConfigError ||
    error instanceof SystemSettingsConfigError
  ) {
    return new NewApiError(error.message, 503, "recharge_unconfigured");
  }
  if (error instanceof PayGatewayError) {
    return new NewApiError(error.message, 502, "pay_gateway_error");
  }
  if (error instanceof BillingAdminError) {
    return new NewApiError(fallbackMessage, 503, "billing_unavailable");
  }
  return toBillingError(error, fallbackMessage);
}
