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
  repo: Pick<RechargeOrderRepo, "findActiveOrder" | "findUnsettledPaidOrder">;
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
 * 商品身份 = 商品类型 + 档位 + **到账积分** + **实付金额**（见 `ActiveOrderIdentity`）。所以：
 *   · 同一档位再点一次 → 复用（这就是重复点击）；
 *   · 换了档位、或档位还是那个档位但运营改过配置（到账积分数变了）→ **算换了商品**，
 *     照常建新单。把「想换一档再买」当成重复而拦下，用户就再也换不了档了；
 *   · 档位 ↔ 自定义充值之间同理（商品类型不同）。
 *
 * <p>⚠️ 金额**算**身份（2026-09-27 修正，此前写的是「不算」）。此前那条注释只看到了复用
 * 这一侧（「冻结的是下单那一刻的价」），漏了用户看到的东西：他照着 ¥499 点了下单、运营随后
 * 改到 ¥599，再点一次时复用的旧单带着**旧价**回来，而界面上的目录价已经是新价 ——
 * 同一个屏幕上于是同时出现两个金额，违反本仓「用户可见界面永远只出现一个金额」，
 * 而且方向可能多收用户的钱。价变了就是另一件商品，照常建新单（旧单留给它自己过期）。
 *
 * <p>── 已有活跃单，但**钱已经收了**（`paid_pending` / `grant_failed`）怎么办 ────────
 *
 * 不复用它的二维码，也不建新单，而是 409。两个理由各管一件事：
 *   · **不复用码**：钱已经付过了，再给他一张能扫的码 = 让他再付一次（网关那边这笔单
 *     已成功，扫码只会撞上「订单已支付」或者更糟）；
 *   · **不建新单**：这正是「用户付了钱卡在发放中 → 关掉弹窗再打开看到空闲态 → 再买一笔
 *     再付一次 → 旧单随后又被补发成功 → 被扣两次钱走客服退款」那条路。拦在服务端。
 *
 * <p>⚠️ **这条判定与商品身份无关，也不看金额**（2026-09-27 再修正，推翻上一版）。
 * 上一版把它塞进「同一件商品」那一查里（`findActiveOrder` 认三种状态）—— 于是判据被绑上了
 * 类型 + 档位 + 积分 + **金额**：用户在途时运营一改价，他再点一次就不命中，建新单、照样能付，
 * **重复收款的防护被一次改价绕开**，而两笔都会到账。
 * 重复收款的依据是「**用户已经付过一笔还没落地的钱**」，与他这次想买什么无关 ——
 * 所以这条判定搬到了不看身份、不看金额的 `findUnsettledPaidOrder`，并且**排在最前面**：
 * 连「换了档位」「改了价」这些正常会放行的情形，只要有一笔已付未落地的单，一律拦住。
 *
 * <p>与「未支付单」的区别是**话不一样**：那一句让用户继续付或稍后再来，这一句告诉他不用再买。
 * 两句都**不再指向「充值记录」**（2026-09-27 修正）：那里是 billing 账本，而一笔还没发放的
 * 订单在账本上**没有任何分录**，用户点过去只会看到「暂无充值记录」—— 指了一个看不到该单的地方。
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
    // ⚠️ **钱已经收了、还没落地**的单排在最前面，且**不看商品身份、不看金额**
    //    （2026-09-27 修正）：这条判定的依据是「这个人已经付过一笔还没落地的钱」，
    //    与他这次想买什么无关。放在后面 / 绑上金额，运营在用户在途时改一次价就能绕开它
    //    （改价 → 不命中 → 建新单 → 再付一次 → 两笔都到账）。
    const unsettled = await deps.repo.findUnsettledPaidOrder(userId);
    if (unsettled) {
      deps.logger.warn(
        `用户重复下单命中一笔已支付的未终态单 tradeNo=${unsettled.tradeNo} `
          + `userId=${unsettled.userId} 状态=${unsettled.status}：不建新单、不复用二维码`,
      );
      throw new NewApiError(
        // ⚠️ 别让用户去「充值记录」看这笔单：那里读的是 billing 账本，而一笔还没发放的订单
        // 在账本上**没有任何分录** —— 他点过去只会看到「暂无充值记录」，比不说还糟。
        // 真正的下一步只有两件：等（我们还在自愈/对账），或者找人（积分一直没到就是异常）。
        `您有一笔订单正在处理中（${unsettled.tradeNo}），请勿重复购买。`
          + `请稍后重试本页；若长时间未到账请联系客服`,
        409,
        "recharge_order_paid",
      );
    }

    const active = await deps.repo.findActiveOrder({
      userId,
      productType: spec.productType,
      tierId: spec.tierId,
      credits: spec.credits,
      amountFen: spec.amountFen,
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
      // 报错让他稍后重试 —— 这个窗口最长只有本列上线后的半小时。
      // ⚠️ 同样**不指向「充值记录」**：未支付的单在 billing 账本上没有分录，那里看不到它。
      throw new NewApiError(
        `您有一笔尚未支付的订单（${active.tradeNo}），请稍后重试本页；若持续失败请联系客服`,
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
