/* ============================================
 * 档位充值单的「这一单是什么、收多少钱、发多少分」。
 *
 * 与自定义充值那侧（`recharge-custom/order-spec.ts`）**同形**：规格构建是纯函数 ——
 * 不读库、不调网关、不看系统时钟（`nowMs` 由调用方传）。于是这几件事能各自被直接单测，
 * 而 `RechargeService` 只在下单那一刻把 IO 做完、把结果传进来。
 * 两侧的分叉点就只剩「谁读什么」，规则本身在同一层。
 * ============================================ */
import { NewApiError } from "@lib/core";
import type { TopupTierView } from "@lib/shared/persistence/index.js";
import {
  canPurchaseTier,
  displayTierName,
  tierDeniedHint,
} from "@lib/shared/topup-tier/constants.js";

/** 档位充值单的落库与下单口径（`RechargeService` 的 `OrderSpec` 在这一侧的形态）。 */
export interface TierOrderPlan {
  /** 档位 ID，已校验为安全整数 */
  tierId: number;
  /** 实付金额，单位分。**唯一**的价格来源，落库与发网关都用它 */
  amountFen: number;
  /**
   * 到账积分 = 档位配的基础积分（**配置值**）。
   *
   * <p>⚠️ 不是「原价 × 换算率」：充值常有折扣，¥499 的档到账 7,500 积分（499×15=7,485）。
   * 原价与折扣只为展示划线价。
   */
  credits: number;
  /** 下单那一刻的换算率快照，只用于对账/客服追溯，**不参与上面那个积分数** */
  creditsPerYuan: number;
  productType: "tier";
  productName: string;
  configVersion: number;
  firstPurchaseEligible: number;
  bonusCredits?: number;
  creditsValidMonths: number;
  permissionResult: string;
  subject: string;
  body: string;
}

/**
 * 校验 + 算价 + 拼快照。
 *
 * <p>**这个函数不读任何东西**：档位视图、换算率、当前时刻都由调用方给。调用方
 * （`RechargeService.buildTierOrderSpec`）负责在下单那一刻读库 —— 档位可能已经下架、
 * 时间窗可能已经过期、权限名单可能已经改过，所以读的时刻必须就是下单的时刻。
 *
 * <p>档位不存在（404）也由调用方判：那是「读不到东西」，与这里的规则无关。
 *
 * @param tier          下单那一刻的档位视图
 * @param creditsPerYuan 下单那一刻的换算率（只快照，不参与积分计算）
 * @param userId        购买人
 * @param nowMs         下单时刻（毫秒）。**显式传入**而不是内部取 `Date.now()` ——
 *                      否则「时间窗判定」这条规则没法被直接测到（要 mock 时钟）
 */
export function buildTierOrderPlan(
  tier: TopupTierView,
  creditsPerYuan: number,
  userId: number,
  nowMs: number,
): TierOrderPlan {
  // ⚠️ 草稿与下架都不可买，但话不能说成同一句（PRD §6.3 / §10.5）：
  // 「已下架」说的是一个曾经卖过的东西，而草稿是**还没上过架** ——
  // 对着一张运营刚建好、字段还没配齐的卡片说「已下架」，客服和用户都无从下手。
  if (tier.status !== "active") {
    throw new NewApiError(tier.status === "draft" ? "该档位尚未上架" : "该档位已下架", 400);
  }
  if (tier.startTime && new Date(tier.startTime).getTime() > nowMs) {
    throw new NewApiError("该档位尚未生效", 400);
  }
  if (tier.endTime && new Date(tier.endTime).getTime() < nowMs) {
    throw new NewApiError("该档位已过期", 400);
  }

  // ⚠️ **购买权限**（PRD §6.3 / §10.4）。这一列在管理端可编辑、有审计文案、
  // 保存时校验得也很严 —— 但它此前**一次都没被读过**：运营配「仅限白名单」，
  // 用户侧照样人人都能买，且没有任何报错。判定与自定义充值那条**同一个函数**，
  // 同一批白名单用户在两条路上必须得到同一个答案。
  const allowed = canPurchaseTier(tier, userId);
  if (!allowed) {
    // 403 不是 400：这不是「你填错了」，是「这个账号没有购买资格」（与自定义充值同口径）
    throw new NewApiError(tierDeniedHint(tier), 403);
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
    // 首购加赠：配置快照随单落库，**发放在 fulfill**。
    //
    // 为什么下单只快照、不在下单时判定「是不是首购」：判据是「这个用户在这个档位上
    // 有没有成功支付过」，而下单此刻可能已经有一笔同档位的未支付单——两笔都判「是首单」
    // 是必然发生的。真正的闸放在发放那一步，用 billing 的唯一索引原子裁决
    // （见 fulfill 里的 `bonus:tier:{userId}:{tierId}`）。
    //
    // ⚠️ 档位不参与首购时不写 bonusCredits（落到默认 0）：这一列在订单上表达的是
    //    「本单挂着多少赠送」。不参与却写个非零值，会让对账以为欠用户一笔赠送。
    firstPurchaseEligible: tier.firstPurchaseEligible ? 1 : 0,
    ...(tier.firstPurchaseEligible && tier.bonusCredits > 0
      ? { bonusCredits: tier.bonusCredits }
      : {}),
    // 有效期快照的是**月数**（运营在后台配的那个数），到期时刻发放那一刻按
    // 支付成功时间折出来 —— 起算点见 `credits-validity.ts`
    creditsValidMonths: tier.creditsValidMonths,
    // ⚠️ **常量 `allowed`，不是三元**：上面判为假时已经抛了 403，被拒的用户
    //    根本到不了这里 —— `denied` 分支是**不可达**的，留着一个走不到的三元
    //    只会让下一个人以为这一列真的有两种取值。
    //    这一列现在的意义是「**记下判定发生在哪**」：判定（上面那次 canPurchaseTier）
    //    确实发生在这个下单路径上，结果随单落库，不是别处补写的。
    permissionResult: "allowed",
    subject: tier.name || "积分充值",
    body: tier.name || `积分充值 ${credits} 积分`,
  };
}
