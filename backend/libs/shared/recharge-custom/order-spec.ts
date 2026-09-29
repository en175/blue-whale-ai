/* ============================================
 * 自定义充值单的「这一单是什么、收多少钱、发多少分」（模块 B，PRD §7.4 / §7.5）。
 *
 * 抽成独立的一步，是因为它是**两种商品类型分叉的唯一落点**：`RechargeService` 把
 * 档位单与自定义单各自算成同一份 `OrderSpec`，之后落库 / 调网关 / 回调 / 到账全部共用。
 * 规则放这里也让它能脱离 Prisma 与网关被直接单测。
 * ============================================ */
import { NewApiError } from "@lib/core";
import type { RechargeCustomConfigView } from "@lib/shared/persistence/index.js";
import {
  canPurchaseCustom,
  customDeniedHint,
  customPriceFen,
  parseCustomCredits,
} from "./constants.js";

/** 自定义充值单的落库与下单口径（`RechargeService` 的 `OrderSpec` 在这一侧的形态）。 */
export interface CustomOrderPlan {
  /** 恒为 null：自定义充值没有档位（迁移 050 把列改成可空） */
  tierId: null;
  /** 实付金额，单位分。**唯一**的价格来源，落库与发网关都用它 */
  amountFen: number;
  /** 到账积分 = 用户要买的那个整数，原样发放 */
  credits: number;
  /** 用配置表自己那条换算率（PRD §7.1），不是定价目录的消费锚点 */
  creditsPerYuan: number;
  productType: "custom";
  productName: string;
  configVersion: number;
  /**
   * 到账积分的有效期快照，单位**月**（PRD §7.4「订单快照：记录…有效期」）。
   *
   * <p>⚠️ 存的是月数而不是算好的时刻：起算点是**支付成功时刻**（§9.5），而下单这一刻
   * 还不知道它。真正的到期时刻由发放路径按 `paid_pending_at + 这个月数` 算出来
   * （见 `recharge/credits-validity.ts`），算完同时交给 billing 与订单快照。
   */
  creditsValidMonths: number;
  /**
   * 下单时服务端判定的权限结果快照（`allowed`）。
   *
   * <p>⚠️ 与档位那条**同一个口径**（M-3，2026-09-27 补）：它**必须由真实判定算出来**，
   * 不能是个写死的常量 —— 这一列要回答的是「这单当时到底判过权限没有」。此前只有档位
   * 那条传真值，自定义充值这条落的是 repo 的默认常量 `allowed`，于是同一列在两条购买
   * 路径上口径不同：档位那边刚论证过「写死 allowed 会让这一列说假话」，这边却正写着。
   *
   * <p>当前实现里被拒的用户根本建不了单（上面 `canPurchaseCustom` 那一步就抛了），
   * 所以落库的值只可能是 `allowed`；但它是**判定出来的** allowed，不是常量 ——
   * 将来加入别的判定分支时这一列自动正确。
   */
  permissionResult: string;
  /** 恒 0：PRD §7.1「第一版默认不对自定义充值发放首购赠送积分」 */
  bonusCredits: number;
  subject: string;
  body: string;
}

/**
 * 校验 + 算价 + 拼快照。
 *
 * <p>配置由调用方在下单那一刻**重新读一次**再传进来：用户可能已经在页面上停留很久，
 * 期间运营改过上下限或换算率（PRD §7.5「创建订单时以服务端最新配置为准」）。
 * 所以这里不接收前端传来的价格 —— 前端那份只是展示，钱一律服务端算。
 *
 * <p>⚠️ 范围与步长**不满足就拒绝，不替用户改数**。PRD §7.3 允许「自动修正或禁止提交」，
 * 这里选禁止：修正意味着用户点的是「买 601 积分」、付的却是别的数的钱，
 * 而金额是支付网关那边核对的第一道闸 —— 服务端擅自改出来的金额与用户看到的对不上。
 * 自动修正是**前端**的事（在提交之前就把值夹回合法格点）。
 *
 * <p>⚠️ **自定义充值不参与首购加赠**（不是遗漏）：
 *   2026-09-28 首购口径定为「**每档首次**」——而自定义充值**没有档位**，也就没有「每档」可言。
 *   所以订单快照的两列仍是默认值（`unknown` / `0` = 不参与加赠）。
 *   档位单那条路由 `buildTierOrderSpec` 快照、`RechargeService.grantFirstPurchaseBonus` 发放。
 *
 *   <p>仍没做的是 PRD §7.2 的「购买后将失去首购加赠资格」确认提示。
 */
export function buildCustomOrderPlan(
  config: RechargeCustomConfigView,
  userId: number,
  rawCredits: unknown,
): CustomOrderPlan {
  if (!config.enabled) {
    throw new NewApiError("自定义充值暂未开放", 400);
  }
  // 权限：与档位同一套枚举（PRD §10.3「与固定积分卡一致」），判定见 `canPurchaseCustom`
  //
  // ⚠️ 判定结果**落到快照里**（不是常量）：被拒的单根本走不到下面，所以这里落库的值
  //    只会是 `allowed` —— 但它是判出来的，与档位那条同一个口径（见 `permissionResult`）
  const allowed = canPurchaseCustom(config, userId);
  if (!allowed) {
    throw new NewApiError(customDeniedHint(config), 403);
  }

  const credits = parseCustomCredits(rawCredits);
  if (credits === null) {
    throw new NewApiError("积分数量须为 1 以上的整数", 400);
  }
  if (credits < config.minCredits || credits > config.maxCredits) {
    throw new NewApiError(
      `积分数量须在 ${config.minCredits} ~ ${config.maxCredits} 之间`,
      400,
    );
  }
  // 步长对齐：低于下限/高于上限已经拦住了，这里拦「不在格点上」的数。
  // 后台配的步长就是「允许买哪些数」的口径；放行非格点值等于让滑杆与手输的约束失效
  // （构造一个请求就能买到管理端都表达不出来的数）。
  if ((credits - config.minCredits) % config.stepCredits !== 0) {
    throw new NewApiError(
      `积分数量须为 ${config.stepCredits} 的整数倍（从 ${config.minCredits} 起算）`,
      400,
    );
  }

  // 价格 = 积分数 ÷ 每元积分数，四舍五入到分。**取整以积分为准**：
  // 到账 N 积分是从用户输入来的、必须原样发放；价格那 ≤ 半分钱的零头由平台承担。
  const amountFen = customPriceFen(credits, config.creditsPerYuan);
  if (amountFen <= 0) {
    // 只有配置畸形（每元积分数极大）才会走到：付 0 元拿积分不是「优惠」，是漏洞
    throw new NewApiError("该积分数折算出的金额不合法，请联系客服", 500);
  }

  return {
    // ⚠️ NULL：自定义充值没有档位。**不要**填 0/1 —— 编出来的数会被按 tier_id 聚合的
    // 对账当成真档位，全部自定义充值会静默聚到某个无辜档位上
    tierId: null,
    amountFen,
    credits,
    creditsPerYuan: config.creditsPerYuan,
    productType: "custom",
    // PRD §9.3「商品名称：例如…『自定义充值』」。写展示名而不是派生名 ——
    // 快照要回答的是「用户当时看到的是哪件商品」
    productName: "自定义充值",
    configVersion: config.version,
    // 快照的是**月数**（运营配多少就记多少），到期时刻发放那一刻按支付成功时间折出来
    creditsValidMonths: config.creditsValidMonths,
    // 判出来的 allowed（不是常量）：这一列要能回答「当时到底判没判」，
    // 与档位那条同口径 —— 两条购买路径落在同一列上的值不能有两套来源
    permissionResult: allowed ? "allowed" : "denied",
    bonusCredits: 0,
    subject: "自定义充值",
    body: `自定义充值 ${credits} 积分`,
  };
}
