import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { createLogger, type Logger } from "@lib/core/logging";
import { fetchCreditsPerYuan, grantCredits } from "@lib/shared/billing/billing-admin-client.js";
import { RECHARGE_LOT_BIZ_TYPE } from "@lib/shared/billing/lot-biz-type.js";
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

const GATEWAY_ORDER_TTL_MS = 2 * 60 * 60 * 1000;

const RECONCILE_INTERVAL_MS = 30 * 1000;

export interface RechargeTierOffer {
  id: string;
  name: string;
  amount: number;
  price: number;
  originalPrice: number;
  discount: number;
  isRecommended: boolean;
  sortOrder: number;
  canPurchase: boolean | null;
  deniedHint: string;
  creditsValidMonths: number;
}

export interface RechargeCatalog {
  tiers: RechargeTierOffer[];
  creditsPerYuan: number;
}

export interface RechargeOrderCreated {
  tradeNo: string;
  cashierUrl: string;
  expiresAt: string;
  amount: number;
  credits: number;
}

export interface CreateTierOrderInput {
  userId: number;
  tierId: string;
}

export interface CreateCustomOrderInput {
  userId: number;
  credits: number;
}

export type CreateRechargeOrderInput = CreateTierOrderInput | CreateCustomOrderInput;

export interface OrderSpec {
  tierId: number | null;
  amountFen: number;
  credits: number;
  creditsPerYuan: number;
  productType: "tier" | "custom";
  productName: string;
  configVersion: number;
  bonusCredits?: number;
  firstPurchaseEligible?: number;
  creditsValidMonths?: number | null;
  permissionResult?: string;
  subject: string;
  body: string;
}

export interface RechargeOrderStateView {
  tradeNo: string;
  status: RechargeOrderStatus;
  creditsAfter: number | null;
}

export interface RechargeGrantRetryResult {
  tradeNo: string;
  status: RechargeOrderStatus;
}


@Injectable()
export class RechargeService {
  private readonly logger: Logger = createLogger("recharge");
  private repoInstance?: RechargeOrderRepo;
  private reuseInstance?: ReturnType<typeof createActiveOrderReuse>;
  private sweeperInstance?: ReturnType<typeof createGrantSweeper>;
  private grantWarnGateInstance?: GrantWindowWarnGate;

  private get repo(): RechargeOrderRepo {
    if (!this.repoInstance) {
      this.repoInstance = createRechargeOrderRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

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

  private get grantWarnGate(): GrantWindowWarnGate {
    this.grantWarnGateInstance ??= createGrantWindowWarnGate();
    return this.grantWarnGateInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOPUP_TIER_REPO_TOKEN)
    private readonly topupTier: TopupTierRepo,
    private readonly settings: SystemSettingsService,
    private readonly custom: RechargeCustomService,
    @Inject(GRANT_RETRY_WINDOW_MS_TOKEN)
    private readonly grantRetryWindowMs: number,
  ) {}


  async listTiers(userId: number | null = null): Promise<RechargeCatalog> {
    const creditsPerYuan = await fetchCreditsPerYuan();
    const rows = await this.topupTier.listActive();
    return {
      creditsPerYuan,
      tiers: rows.map((t) => {
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
          canPurchase: userId === null ? null : canPurchaseTier(t, userId),
          deniedHint: tierDeniedHint(t),
          creditsValidMonths: t.creditsValidMonths,
        };
      }),
    };
  }


  async createOrder(input: CreateRechargeOrderInput): Promise<RechargeOrderCreated> {
    const spec =
      "tierId" in input
        ? await this.buildTierOrderSpec(input)
        : await this.buildCustomOrderSpec(input);
    const reused = await this.reuseActiveOrder(input.userId, spec);
    if (reused) return reused;
    return this.placeOrder(input.userId, spec);
  }

  private async buildTierOrderSpec(input: CreateTierOrderInput): Promise<OrderSpec> {
    const creditsPerYuan = await fetchCreditsPerYuan();

    const tier = await this.topupTier.getById(input.tierId);
    if (!tier) throw new NewApiError("档位不存在", 404);

    return buildTierOrderPlan(tier, creditsPerYuan, input.userId, Date.now());
  }

  private async buildCustomOrderSpec(input: CreateCustomOrderInput): Promise<OrderSpec> {
    return buildCustomOrderPlan(
      await this.custom.requireConfig(),
      input.userId,
      input.credits,
    );
  }

  private async placeOrder(userId: number, spec: OrderSpec): Promise<RechargeOrderCreated> {
    const merchant = await this.settings.requirePayMerchantConfig();

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
      ...(spec.firstPurchaseEligible !== undefined
        ? { firstPurchaseEligible: spec.firstPurchaseEligible }
        : {}),
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
      cashierUrl: order.cashierUrl,
    });    if (!bound) {
      this.logger.error(
        `订单绑定网关订单号失败 tradeNo=${tradeNo} payOrderId=${order.payOrderId}`,
      );
    }

    return {
      tradeNo,
      cashierUrl: order.cashierUrl,
      expiresAt: new Date(Date.now() + CASHIER_TOKEN_TTL_MS).toISOString(),
      amount: spec.amountFen / 100,
      credits: spec.credits,
    };
  }


  async listOrdersForAdmin(filter: RechargeOrderListFilter): Promise<RechargeOrderPage> {
    return this.repo.list(filter);
  }

  async loadOrdersByTradeNos(
    tradeNos: readonly string[],
  ): Promise<Map<string, RechargeOrderView>> {
    const rows = await this.repo.listByTradeNos(tradeNos);
    return new Map(rows.map((row) => [row.tradeNo, row]));
  }


  async getOrderStatus(input: {
    userId: number;
    tradeNo: string;
  }): Promise<RechargeOrderStateView> {
    const order = await this.loadOwnOrder(input.userId, input.tradeNo);
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
        this.logger.warn(
          `到账后查余额失败 tradeNo=${current.tradeNo}：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { tradeNo: current.tradeNo, status: current.status, creditsAfter };
  }

  private async reconcile(order: RechargeOrderView): Promise<RechargeOrderView> {
    const age = Date.now() - Date.parse(order.createdAt);
    if (age > GATEWAY_ORDER_TTL_MS) {
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
        await this.repo.markExpired(order.tradeNo);
      }
    } catch (error) {
      this.logger.warn(
        `查单补偿失败 tradeNo=${order.tradeNo}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return (await this.repo.getByTradeNo(order.tradeNo)) ?? order;
  }


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
      this.logger.error(`回调订单不存在 mchOrderNo=${tradeNo}`);
      return false;
    }
    await this.repo.recordNotify(tradeNo);

    if (order.status === RECHARGE_ORDER_STATUS.paid) {
      return true;
    }

    const state = Number(params.state);
    if (state === PAY_ORDER_STATE.success) {
      const notifiedFen = Number(params.amount);
      if (!Number.isFinite(notifiedFen) || notifiedFen !== order.amountFen) {
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

    this.logger.error(`回调非终态 state=${params.state} tradeNo=${tradeNo}`);
    return false;
  }

  private async retryFulfill(order: RechargeOrderView): Promise<RechargeOrderView> {
    if (!(await this.repo.claimQuerySlot(order.tradeNo, RECONCILE_INTERVAL_MS))) {
      return order;
    }

    const held = Date.now() - Date.parse(order.paidPendingAt ?? order.createdAt);
    if (held > this.grantRetryWindowMs) {
      if (this.grantWarnGate.shouldWarn(order.tradeNo)) {
        this.logger.warn(
          `补发已超出 ${Math.round(this.grantRetryWindowMs / 60_000)} 分钟重试窗口，不再打 billing：`
            + `tradeNo=${order.tradeNo} 已等=${Math.round(held / 60_000)} 分钟`
            + `（订单停在 ${order.status}，等主动对账或人工处理）`,
          { event: "recharge.grant_retry_window_exceeded", trade_no: order.tradeNo },
        );
      }
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
    return this.loadOwnOrder(Number(order.userId), order.tradeNo);
  }

  private async fulfill(order: RechargeOrderView): Promise<void> {
    await this.repo.markPaidPending(order.tradeNo);

    const settled = (await this.repo.getByTradeNo(order.tradeNo)) ?? order;
    const paidAt = new Date(settled.paidPendingAt ?? Date.now());
    const expiresAt =
      settled.creditsValidMonths === null
        ? null
        : creditsExpireAt(paidAt, settled.creditsValidMonths);

    const { duplicated } = await grantCredits({
      userId: Number(order.userId),
      credits: order.credits,
      bizId: order.tradeNo,
      bizType: RECHARGE_LOT_BIZ_TYPE,
      ...(expiresAt ? { expiresAt } : {}),
    });

    const firstPurchaseState = await this.grantFirstPurchaseBonus(settled, expiresAt);

    const updated = await this.repo.markPaid({
      tradeNo: order.tradeNo,
      ...(expiresAt ? { creditsExpireAt: expiresAt } : {}),
      ...(firstPurchaseState ? { firstPurchaseState } : {}),
    });
    if (!updated) {
      this.logger.warn(
        `订单已到账，本次为重放 tradeNo=${order.tradeNo} duplicated=${duplicated}`,
      );
    }
  }

  private async grantFirstPurchaseBonus(
    settled: RechargeOrderView,
    expiresAt: Date | null,
  ): Promise<string | null> {
    if (settled.firstPurchaseEligible !== 1 || settled.bonusCredits <= 0) return null;
    if (settled.tierId === null) return null;

    const { duplicated, existingBizId } = await grantCredits({
      userId: Number(settled.userId),
      credits: settled.bonusCredits,
      source: "bonus",
      bizId: settled.tradeNo,
      bizType: RECHARGE_LOT_BIZ_TYPE,
      grantKey: `bonus:tier:${settled.userId}:${settled.tierId}`,
      ...(expiresAt ? { expiresAt } : {}),
    });

    if (!duplicated) return "first";

    if (existingBizId === null) {
      this.logger.warn(
        `首购赠送撞键但拿不到归属，状态保持未判定 tradeNo=${settled.tradeNo}`,
      );
      return null;
    }
    return existingBizId === settled.tradeNo ? "first" : "repeat";
  }


  async sweepStaleGrants(options: {
    batchSize?: number;
    claimMs: number;
    retryWindowMs?: number;
  }): Promise<GrantSweepResult> {
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


  async retryGrantForAdmin(tradeNo: string): Promise<RechargeGrantRetryResult> {
    const order = await this.repo.getByTradeNo(tradeNo);
    if (!order) throw new NewApiError("订单不存在", 404);

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
      this.logger.error(
        `人工补发失败 tradeNo=${tradeNo}：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const after = await this.repo.getByTradeNo(tradeNo);
    return { tradeNo, status: after?.status ?? order.status };
  }


  private async loadOwnOrder(userId: number, tradeNo: string): Promise<RechargeOrderView> {
    const order = await this.repo.getByTradeNo(tradeNo);
    if (!order || order.userId !== String(userId)) {
      throw new NewApiError("订单不存在", 404);
    }
    return order;
  }
}

function generateTradeNo(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `RC${stamp}${randomBytes(4).toString("hex")}`;
}
