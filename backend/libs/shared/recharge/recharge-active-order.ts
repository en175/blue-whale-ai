/* ============================================
 * 「这个用户这件商品已经有一笔未支付单」时怎么办 —— 下单防重的判定全在这里
 * （PRD §6.7 / §7.5「服务端避免重复有效订单」）。
 *
 * 前端 `RechargeModal` 里那个 `if (paying) return` 只拦得住「同一个页面上的连点」：
 * 换个入口、刷新页面、关掉弹窗再打开，请求照样到得了服务端。所以这道闸必须在服务端。
 *
 * 抽成独立文件而不是留在 `RechargeService` 里的两个理由：它是**一条可以被单独读完的规则**
 * （下面那一大段口径就是它存在的理由），而 `recharge.service.ts` 有 800 行硬线。
 * ============================================ */
import { NewApiError } from "@lib/core";
import type { Logger } from "@lib/core/logging";
import type { RechargeOrderRepo, RechargeOrderView } from "@lib/shared/persistence/index.js";
import { RECHARGE_ORDER_STATUS } from "@lib/shared/persistence/index.js";
import type { OrderSpec, RechargeOrderCreated } from "./recharge.service.js";

/**
 * 银行统一收银台令牌有效期 30 分钟（实测 `tokenBegin`~`tokenEnd`）。
 *
 * <p>它同时管两件事，所以两处都不能各写一遍：**能不能复用**一张收银台链接（见下），
 * 以及 `reconcile` 里「用户已经扫不了码了吗」的那条过期线。
 */
export const CASHIER_TOKEN_TTL_MS = 30 * 60 * 1000;

export interface ActiveOrderReuseDeps {
  repo: Pick<RechargeOrderRepo, "findActivePending">;
  /** 把一笔 `pending` 单往终态推一步（问网关 + 过期判定）；复用判定要用它的结果 */
  reconcile: (order: RechargeOrderView) => Promise<RechargeOrderView>;
  logger: Logger;
}

/**
 * 同一用户、同一商品已有**未支付**订单时不建新单 —— 判定「是重复点击还是换了商品」的地方。
 *
 * <p>── 为什么选「复用」而不是「报错让用户去看那一笔」 ────────────────────────────
 *
 * 用户连点两次的本意是「我要付这一笔」，不是在问「我有几笔单」。给他一个报错、让他自己
 * 去充值记录里找那条单，是把服务端的判断成本转嫁给了用户；而**给他两个不同的收银台链接
 * 更糟** —— 两条链接都有效，他可能两条都扫，于是付两笔。复用（还他同一个链接）是唯一
 * 「点几次都只有一笔要付」的结果。
 *
 * <p>── 为什么链接必须**存下来**才能复用 ───────────────────────────────────────
 *
 * 网关的支付订单按 (`mch_no`, `mch_order_no`) 唯一（`Uni_MchNo_MchOrderNo`）：拿同一个
 * 商户订单号再下一次单会被拒成「商户订单[..]已存在」。所以复用只能是「把下单时存下来的
 * 那条链接原样还给他」，不可能「同一个单号再要一条新链接」。链接存在订单行的
 * `cashier_url` 列（见迁移 051），下单应答回来时与网关订单号同一次写入。
 *
 * <p>── 什么才算「同一件商品」 ─────────────────────────────────────────────────
 *
 * 商品身份 = 商品类型 + 档位 + **到账积分**（见 `ActiveOrderIdentity`）。所以：
 *   · 同一档位再点一次 → 复用（这就是重复点击）；
 *   · 换了档位、或档位还是那个档位但运营改过配置（到账积分数变了）→ **算换了商品**，
 *     照常建新单。把「想换一档再买」当成重复而拦下，用户就再也换不了档了；
 *   · 档位 ↔ 自定义充值之间同理（商品类型不同）。
 *
 * 金额**不算**身份：订单行里冻结的是下单那一刻的价，运营在待支付期间改价不该改口，
 * 复用的就是那一笔已经报过价的单。
 *
 * <p>── 令牌过期了怎么办 ───────────────────────────────────────────────────────
 *
 * 收银台链接里的银行令牌只有 30 分钟。超时之后再复用，等于还给用户一张扫不了的二维码 ——
 * 那时这张单**已经不是有效订单**了，照常建新单。但建之前**先问一次网关**（`reconcile`）：
 * 用户可能真付了钱而回调丢了，那种单要在这里被补发到账，而不是被无声地丢在一边。
 *
 * <p>⚠️ 残留的竞态：两个请求同时到这里、都查不到已有单，就会各建一笔。
 * 本地表没有能拦住它的唯一约束（同一用户同一商品在不同时刻**本来就**可以有多笔），
 * 所以只能靠这一查。后果是**多一笔待支付单**，不是多发积分 —— 每笔单各自付款、各自发放。
 */
export function createActiveOrderReuse(
  deps: ActiveOrderReuseDeps,
): (userId: number, spec: OrderSpec) => Promise<RechargeOrderCreated | null> {
  return async function reuseActiveOrder(userId, spec) {
    const active = await deps.repo.findActivePending({
      userId,
      productType: spec.productType,
      tierId: spec.tierId,
      credits: spec.credits,
    });
    if (!active) return null;

    // 网关订单号与收银台链接是同一次更新写进去的，所以「没有网关订单号」= 这张单
    // **从来没拿到过**链接（下单那次网关调用就失败了，比如超时）。那不是一笔有效订单，
    // 不该拦着用户重下 —— 否则用户会被一笔永远付不了的单卡住半小时。
    if (!active.payOrderId) return null;

    const age = Date.now() - Date.parse(active.createdAt);
    if (active.cashierUrl && age <= CASHIER_TOKEN_TTL_MS) {
      // 令牌还活着，链接原样还给他。`expiresAt` 按下单时刻加令牌有效期算，
      // 而令牌其实是下单**应答**那一刻签发的（晚几毫秒）—— 差值是保守方向，不影响扫码。
      deps.logger.info(
        `复用未支付的同商品订单 tradeNo=${active.tradeNo} userId=${active.userId}`,
      );
      return {
        tradeNo: active.tradeNo,
        cashierUrl: active.cashierUrl,
        expiresAt: new Date(
          Date.parse(active.createdAt) + CASHIER_TOKEN_TTL_MS,
        ).toISOString(),
        amount: active.amountFen / 100,
        credits: active.credits,
      };
    }

    if (active.cashierUrl === null && age <= CASHIER_TOKEN_TTL_MS) {
      // 令牌还没过期，但我们**拿不出链接**（本列上线前创建的存量单，那时没存 URL）。
      // 这时既不能复用（给不出链接），也不该建新单（旧单还有效，用户可能正扫着它）。
      // 报错让他去充值记录里看那一笔 —— 这个窗口最长只有本列上线后的半小时。
      throw new NewApiError(
        `您有一笔尚未支付的订单（${active.tradeNo}），请前往「充值记录」继续支付或稍后重试`,
        409,
        "recharge_order_pending",
      );
    }

    // 令牌已过期：这张单不可能再被付掉，用户可以重新下单。但先问一次网关再放手 ——
    // 钱可能**早就到了**、只是回调丢了，`reconcile` 会把它补发到账（顺带把死单推到终态，
    // 不会留下一笔永远 pending 的孤儿单）。
    const settled = await deps.reconcile(active);
    if (settled.status !== RECHARGE_ORDER_STATUS.pending) {
      deps.logger.warn(
        `重新下单时发现旧单已了结 tradeNo=${active.tradeNo} 旧状态=${active.status} 新状态=${settled.status}`,
      );
    }
    return null;
  };
}
