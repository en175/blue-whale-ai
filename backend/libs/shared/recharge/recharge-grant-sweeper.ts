/* ============================================
 * 主动对账的一轮：扫「钱到了、积分没发完」且已经等太久的单，逐笔再推一次发放（#45）。
 *
 * ── 它补的是哪一半 ────────────────────────────────────────────────────────────
 *
 * 到账的两条自愈路径都**要有人在**：
 *   · 网关的异步通知只重投 6 次（约 15 分钟），过了就不再推；
 *   · `getOrderStatus` 的补发要用户开着页面轮询才会发生。
 * 用户关掉页面之后，一次发放失败的单就再没有任何人来碰它 —— 钱收了、积分永远不发。
 * 这一轮补的就是那一段：**没人在看的单也自己好起来**。
 *
 * ── 对每一笔做三件事 ──────────────────────────────────────────────────────────
 *
 *   1. **先抢一个名额**（`claimQuerySlot`）—— 名额记在库里而不是进程内存：多副本部署时
 *      各记各的内存等于没限流。抢不到 = 别的副本这几分钟内已经在管这一笔了，跳过它。
 *      ⚠️ 名额**只挡第 2 步**（那才是对 billing 的真实调用）：第 3 步的「升级」一次 billing
 *      都不打，不能被它挡住 —— 否则用户在轮询时（30 秒的名额一直被用户续上、5 分钟的名额
 *      永远抢不到）这个任务会一步都不执行，见 `retryEach` 的说明；
 *   2. 再调一次发放（`retryGrant`，即 `RechargeService.fulfill`：先置待到账 → 发放 → 置到账）。
 *      幂等由 billing 的 `purchased:{tradeNo}` 键兜底，重复调用不会重复发积分；
 *   3. 仍失败就标 `grant_failed` 并**打一条结构化 WARN**，让人能去查（第 1 步抢不到名额时
 *      也标 —— 那一轮探不到补发结果，但「钱到账 30 分钟还没发出去」这个事实已经成立）。
 *
 * ── 异常逐笔吞、只累加计数 ────────────────────────────────────────────────────
 *
 * 一条坏数据不能让同批其余单这轮白扫（与 billing `CreditExpirySweeper` 同一条纪律）。
 * 逃到调用方的那一层还有一道兜底（定时任务里的 `sweep()`），两道都要有 —— 后者防的是
 * 「异常逃出定时器回调把任务永久停掉」，前者防的是「一笔坏数据带走一整轮」。
 *
 * ── 为什么 `grant_failed` 的单也在扫描范围内 ──────────────────────────────────
 *
 * `grant_failed` 是**给人看的信号**，不是终点：钱已经收了、积分还没发。只扫 `paid_pending`
 * 的话，一笔单被标异常之后就再也没有任何自动重试去碰它 —— billing 恢复之后它也不会自愈，
 * 只能等人一条条手工补。持续重试是安全的（发放幂等），所以取数把它一起捞起来
 * （见 `RechargeOrderRepo.listGrantsToRetry`），只是**不再重复叫人**：
 * WARN 只在「本次由我标记」那一次打（`markGrantFailed` 的返回值正是这个意思），
 * 之后的每轮重试失败记 info —— 否则一个卡住的单会每 5 分钟朝日志里喊一次。
 *
 * ── 但重试**有上限**：`GRANT_RETRY_WINDOW_MS` ────────────────────────────────
 *
 * 「无限期重试」在纸上很安全（发放幂等、重复调用不会多发），在线上不是：一个**永久**坏掉的单
 * 会每 5 分钟打一次 billing，永远不停。它烧的是两个成本 —— billing 那边每一次都是一轮真实的
 * 计价/记账调用，日志这边每轮都在写同一行。更重要的是它**没有出口**：那个单永远不会变成
 * 已到账，也没有任何一个状态叫「放弃」。
 *
 * 所以以「**钱到账的时刻**」（`paid_pending_at`）为起点划一个窗口，超窗就不再重试。
 * 起点为什么不是「被标 `grant_failed` 的时刻」：用户等的是「我的积分到没到」，不是我们
 * 内部把哪一列改成了什么。一笔钱到账 3 天后才第一次被标异常，与到账当天就被标异常，
 * 对用户是同一件事 —— 都该从钱到账那一秒开始算我们欠他多久。
 *
 * ⚠️ **超窗不改订单状态**：没有「放弃」这个状态，也不该为一个兜底动作新造一个。
 * 库里那些行看起来仍然只是「卡住」（这正是 `AbandonedGrants` 要报出来的原因）——
 * 让人去处理，而不是替人把它标成某种「处理过」。
 * ============================================ */
import type { Logger } from "@lib/core/logging";
import type {
  AbandonedGrants,
  RechargeOrderRepo,
  RechargeOrderView,
} from "@lib/shared/persistence/index.js";

/**
 * 阈值：**支付成功之后**再过多久还没发完积分，就算到账异常（30 分钟）。
 *
 * <p>为什么是 30 分钟（不是 5 分钟也不是 2 小时）：
 *   · 网关订单有效期 2 小时、银行收银台令牌 30 分钟 —— 钱能付进来的最晚时刻由它们决定；
 *   · 而**支付成功之后**的发放只是一次 billing 调用（正常是亚秒级）。所以「钱到账后 30 分钟
 *     还没发出去」已经远超任何正常的发放耗时，不存在「再等等就好了」的合理期待；
 *   · 它同时是**收银台令牌的有效期**：一个还在有效期内、用户可能正扫着码的单，
 *     绝不会在这一步被标成异常。
 *
 * <p>⚠️ 时钟从 `paid_pending_at`（钱到的时刻）起算，**不是**下单时刻：用户下单后隔 25 分钟
 * 才付款是常事，按下单时刻算会把「刚付了 5 分钟」的单当成异常处理。
 */
export const GRANT_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * 每轮最多处理几笔。
 *
 * <p>与 billing 的 `CreditExpirySweeper` 同一条纪律：一轮有界，多出来的下一轮继续
 * （取数按最旧优先，所以不会饿死）。这是兜底，不追求一轮扫完。
 *
 * <p>⚠️ 它必须有个有界的默认值：取数直接进 SQL 的 `LIMIT`，不传就是**不限量** ——
 * 一个积压了几万笔异常单的环境，一轮会把它们全捞进内存、逐笔打 billing。
 */
export const GRANT_SWEEP_BATCH_SIZE = 200;

/**
 * 重试窗口：从「**钱到账的时刻**」（`paid_pending_at`）起算，最多重试这么久（默认 2 小时）。
 *
 * <p>为什么以钱到账为起点（而不是「首次被标 `grant_failed` 的时刻」）：用户等的是「我的积分
 * 到没到」，不是我们内部把哪一列改成了什么。一笔钱到账 3 天后才第一次被标异常，与到账当天
 * 就被标异常，对用户是同一件事 —— 计时该从钱到账那一秒开始。
 *
 * <p>为什么是 2 小时：
 *   · 网关订单有效期与银行收银台令牌都以「小时」计，2 小时是这一整条支付链路上最长的那个
 *     时间尺度 —— 一次账已经到账的发放（亚秒级的 billing 调用）拖到 2 小时，早就不在
 *     「再等等就能好」的范围里了，只可能是真的坏了；
 *   · 它同时是**兜底的兜底**：网关重投约 15 分钟、用户轮询随时可能补发，2 小时给了这两条
 *     自愈路径足够多的机会，不会把「还在自愈中」的单判成超窗；
 *   · 2 小时 = 24 轮（默认 5 分钟一轮），每一轮都是真实的 billing 调用 —— 再往上加，
 *     一个永久坏单打 billing 的次数就只是为了「万一」而付。
 *
 * <p>⚠️ **不是「放弃」**：超窗之后只是不再重试，订单状态一个都不改（没有「放弃」这个状态），
 * 而这件事必须**看得见** —— 见 `sweepStaleGrants` 里那条 `recharge.grant_retry_exhausted`。
 *
 * <p>可配：`RECHARGE_GRANT_RETRY_WINDOW_MS`。**默认值与读取都只有这一处**（这个常量与
 * {@link resolveGrantRetryWindowMs}；任务侧那个 `DEFAULT_GRANT_RETRY_WINDOW_MS` 只是它的别名）：
 * 这个窗口有**两个**消费者 —— 本扫描器，与用户轮询那条补发路（`RechargeService.retryFulfill`）。
 * 两处各读一次 env，就会出现「参数只对一条路生效」，
 * 而那正是本模块最怕的故障形态（一条路看着正常、另一条路早就不是配的那个数）。
 * 取值必须**大于** `GRANT_STALE_AFTER_MS`，否则「够格重试」与「已经超窗」两个条件的交集为空 ——
 * 表现为一轮都不会重试（配置读取侧会挡掉这种值，见 {@link resolveGrantRetryWindowMs}）。
 */
export const GRANT_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * 重试窗口的 **env → 毫秒** 解析，全仓唯一一处（`RECHARGE_GRANT_RETRY_WINDOW_MS`）。
 *
 * <p>它比「读一个正整数」多一条约束：**必须大于 `GRANT_STALE_AFTER_MS`**。
 * 窗口不比判定阈值长的话，「够格重试」（早于 30 分钟）与「已超窗」（早于窗口起点）
 * 两个条件的**交集为空** —— 一轮都不会重试，而任务看上去完全正常（心跳在打、日志没有报错）。
 * 所以这种取值一律退回默认值，并**吵一声**。
 *
 * <p>仍然**不拒启**：兜底任务不该因为配错一个数字把整个后端拦在启动之外。
 *
 * <p>⚠️ 由装配层（`RechargeLibModule` 的工厂）调用一次，结果经 {@link GRANT_RETRY_WINDOW_MS_TOKEN}
 * 注入给**两个**消费者（定时任务与 `RechargeService`）—— 谁都不许自己再读一遍 env。
 */
export function resolveGrantRetryWindowMs(
  raw: string | undefined,
  logger: Logger,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > GRANT_STALE_AFTER_MS) return parsed;
  // 空串等于「没配」，那是正常路径，不吵
  if (raw !== undefined && raw.trim() !== "") {
    logger.warn(
      `主动对账重试窗口配置非法（RECHARGE_GRANT_RETRY_WINDOW_MS=${raw}）：`
        + `必须大于判定阈值 ${GRANT_STALE_AFTER_MS} 毫秒，否则一轮都不会重试；`
        + `已退回默认值 ${GRANT_RETRY_WINDOW_MS} 毫秒`,
    );
  }
  return GRANT_RETRY_WINDOW_MS;
}

/**
 * 把解析出来的重试窗口交给消费者的注入令牌（见 {@link resolveGrantRetryWindowMs}）。
 *
 * <p>为什么要经令牌而不是各自读 env：这个窗口同时管着扫描器与用户轮询那条路，
 * 而「用户轮询」那条路上的窗口此前写死在代码里 —— 运维把 env 调大之后，两条路各用各的数，
 * WARN 里报的分钟数也跟着变成假话。env 只解析一次、只注入一次，两条路才不可能漂。
 */
export const GRANT_RETRY_WINDOW_MS_TOKEN = Symbol("GRANT_RETRY_WINDOW_MS");

/**
 * 超窗 WARN 里最多带几笔样本。
 *
 * <p>要的是「足够让人判断这是不是同一个原因造成的批量故障」，不是一份完整清单 ——
 * 完整清单看 `recharge.grant_retry_exhausted` 里的 count，再去库里按状态捞。
 */
export const GRANT_ABANDONED_SAMPLE_SIZE = 5;

/** 一轮主动对账的结果（日志与测试用；权威永远是订单行本身，不是这里的计数）。 */
export interface GrantSweepResult {
  /** 本轮取到的待处理单数（可能因 batchSize 被截断） */
  scanned: number;
  /** 本轮补发成功的笔数 */
  healed: number;
  /** 本轮**由我**标成 `grant_failed` 的笔数（要人来看的就这些） */
  flagged: number;
  /** 本轮重试仍失败、但早已是 `grant_failed` 的笔数（不重复叫人） */
  stillFailing: number;
  /** 本轮没抢到名额、留给别的副本处理的笔数 */
  skipped: number;
  /**
   * 已超出重试窗口、**本轮起不再重试**的单数（全部，不只是样本）。
   *
   * <p>⚠️ **-1 = 这一轮没查出来**（超窗统计自己失败了，见 `recharge.grant_retry_exhausted_query_failed`），
   * 与 0（确实没有超窗单）不是一回事 —— 别把 -1 当成「钱都好好的」。
   */
  abandoned: number;
}

export interface GrantSweeperDeps {
  repo: Pick<
    RechargeOrderRepo,
    | "listGrantsToRetry"
    | "listGrantsPastRetryWindow"
    | "claimQuerySlot"
    | "markGrantFailed"
  >;
  /** 重推一次发放（幂等）。实现方别在这里吞异常 —— 失败要能被下面这个 catch 看见 */
  retryGrant: (order: RechargeOrderView) => Promise<void>;
  logger: Logger;
}

/**
 * 一笔「钱到了、积分没发完」的单已经持有多少分钟（WARN / 日志用它说话）。
 *
 * <p>从 `paidPendingAt`（钱到的时刻）起算；存量行没有那个时刻就退回下单时刻 —— 宁可在
 * 日志里显得久一点，也不要因为一列为空而让「拖了 3 天」看起来像「刚刚才卡住」。
 */
export function heldMinutes(order: RechargeOrderView): number {
  const since = Date.parse(order.paidPendingAt ?? order.createdAt);
  return Math.max(0, Math.round((Date.now() - since) / 60_000));
}

export function createGrantSweeper(
  deps: GrantSweeperDeps,
): (
  options: { batchSize?: number; claimMs: number; retryWindowMs?: number },
) => Promise<GrantSweepResult> {
  return async function sweepStaleGrants(options) {
    const batchSize = options.batchSize ?? GRANT_SWEEP_BATCH_SIZE;
    const retryWindowMs = options.retryWindowMs ?? GRANT_RETRY_WINDOW_MS;
    // 两个时刻都从 Date.now() 一次算出：分别取 now 会让「上界」比「下界」晚几毫秒，
    // 极端情况下同一行同时落在「够格重试」与「还没够格」两侧（边界抖动）。
    const now = Date.now();
    const staleBefore = new Date(now - GRANT_STALE_AFTER_MS);
    const windowStart = new Date(now - retryWindowMs);

    const stale = await deps.repo.listGrantsToRetry({ staleBefore, windowStart }, batchSize);

    // 超窗统计**只影响可见性**，所以它单独 try：它挂了不能让这一轮的补发也白等 5 分钟
    // （与「一笔坏数据不带走上百笔」是同一条纪律，只是这次会白扫的是整轮）。
    // ⚠️ 失败时记 **-1（未知）而不是 0**：0 是「确实没有超窗单」这个正面结论，
    //    拿它顶替「没查出来」会把一个坏掉的统计伪装成「钱都好好的」。
    let abandoned: AbandonedGrants = { total: 0, samples: [] };
    try {
      abandoned = await deps.repo.listGrantsPastRetryWindow(windowStart, GRANT_ABANDONED_SAMPLE_SIZE);
    } catch (error) {
      abandoned = { total: -1, samples: [] };
      deps.logger.warn(
        `主动对账：已超窗单数的统计失败（本轮补发不受影响，但超窗笔数本轮未知）：`
          + `${error instanceof Error ? error.message : String(error)}`,
        { event: "recharge.grant_retry_exhausted_query_failed" },
      );
    }

    if (abandoned.total > 0) {
      reportAbandoned(deps.logger, abandoned, retryWindowMs);
    }

    const counts = await retryEach(deps, stale, options.claimMs);
    const result = { scanned: stale.length, ...counts, abandoned: abandoned.total };
    // 每轮一条心跳指标（info 级 JSON 行，TLS 侧可聚合）：定时任务最怕的不是报错，
    // 是**静默没跑** —— 一行都搜不到才是最难查的那种故障。
    // 字段名手写成 snake_case：这条会进 TLS 索引，驼峰在这里是本仓明确不要的口径
    deps.logger.metric({
      event: "recharge.grant_sweep",
      fields: {
        scanned: result.scanned,
        healed: counts.healed,
        flagged: counts.flagged,
        still_failing: counts.stillFailing,
        skipped: counts.skipped,
        // 也进心跳：这样「停止重试的笔数」既能在 WARN 里被看见，也能在指标上被告警
        abandoned: result.abandoned,
      },
    });
    return result;
  };
}

/** 一轮里逐笔重试的计数（异常逐笔吞，所以四种结局都要各记一笔）。 */
interface RetryCounts {
  healed: number;
  flagged: number;
  stillFailing: number;
  skipped: number;
}

/**
 * 逐笔重推发放：抢名额 → 重试 → 失败标异常。
 *
 * <p>抽出来只为让 `sweepStaleGrants` 一眼能读完（取数、可见性、逐笔重试三段各归其位）。
 *
 * <p>⚠️ **名额只挡「补发」，不挡「升级」**（2026-09-27 评审修正）。`claimQuerySlot` 记的是
 * `last_query_at` 这一列，而**两条路共用它**：用户轮询那条按 30 秒抢（`RECONCILE_INTERVAL_MS`），
 * 本扫描器按一轮的间隔抢（默认 5 分钟）。用户只要开着充值弹窗，30 秒的名额就被他一次次续上，
 * 5 分钟的名额**永远抢不到** —— 于是此前这段代码每次都走 `skipped`，一步都不执行：
 * `markGrantFailed` 不发生、「到账异常」那条 WARN（自称是它唯一能被看见的地方）一次都不打。
 * 而「用户盯着一直失败」恰恰是最该升级的场景，两条路的门槛却互相把对方饿死了。
 *
 * <p>所以：**抢不到名额时也升级**。理由不是「反正幂等」，是**层级**——名额存在的唯一目的是
 * 「别把 billing 打爆」，而升级（改一行状态 + 打一条 WARN）一次 billing 都不打。拿一个为
 * billing 设的门槛去挡一个不碰 billing 的动作，本来就不成立。补发那一步仍然归名额管，
 * 每 3 秒轮询不会变成每 3 秒打一次 billing。
 *
 * <p>抢不到名额时探不到那次补发的结果（那正是名额的意思），但这不影响升级的成立：能进到
 * 这一轮的单本来就满足「钱到账 `GRANT_STALE_AFTER_MS` 了、积分还没发出去」—— 那就是
 * `heldMinutes` 一路算下来的「到账异常」的定义。真被别的路径救活了（补发成功）时
 * `markGrantFailed` 也标不动它（那条 UPDATE 只认 `paid_pending`），不会误报。
 */
async function retryEach(
  deps: GrantSweeperDeps,
  stale: RechargeOrderView[],
  claimMs: number,
): Promise<RetryCounts> {
  const counts: RetryCounts = { healed: 0, flagged: 0, stillFailing: 0, skipped: 0 };
  for (const order of stale) {
    try {
      if (!(await deps.repo.claimQuerySlot(order.tradeNo, claimMs))) {
        // 抢不到 = 这几分钟内已经有别人在管这一笔（用户轮询、别的副本）。
        // 升级照做（见函数头）；标不动（已经是 grant_failed，或已被救活）就记 skipped
        if (await flagGrantFailed(deps, order, NOT_CLAIMED_REASON)) {
          counts.flagged += 1;
        } else {
          counts.skipped += 1;
        }
        continue;
      }
      await deps.retryGrant(order);
      counts.healed += 1;
      deps.logger.info(
        `主动对账补发成功 tradeNo=${order.tradeNo} userId=${order.userId} `
          + `金额=${order.amountFen / 100} 元 持有=${heldMinutes(order)} 分钟`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // markGrantFailed 的返回值就是「本次是否由我把它标成异常」：
      // 只有那一次才值得叫人，之后的每轮重试失败都只是「还是没发出去」。
      if (await flagGrantFailed(deps, order, detail)) {
        counts.flagged += 1;
      } else {
        counts.stillFailing += 1;
        deps.logger.info(
          `到账异常单重试仍失败 tradeNo=${order.tradeNo} 持有=${heldMinutes(order)} 分钟：${detail}`,
        );
      }
    }
  }
  return counts;
}

/** 抢不到名额时那条 WARN 的「原因」：不是补发失败，是**这一轮没轮到我们去探**。 */
const NOT_CLAIMED_REASON =
  "本轮没抢到补发名额（用户轮询或其他副本正在处理这一笔），没探到补发结果";

/**
 * 把一笔单升级成「到账异常」：**本次由我标记**时打那条唯一的 WARN，并返回 true。
 *
 * <p>返回 false = 它已经是异常状态（或已经不是 `paid_pending` 了，例如刚被并发的补发救活）
 * —— 那种情况**不重复叫人**，由调用方自己记那一笔账。
 *
 * <p>幂等，且**不需要名额**：只改一行状态、打一条 WARN，一次 billing 都不打（见 `retryEach`）。
 */
async function flagGrantFailed(
  deps: GrantSweeperDeps,
  order: RechargeOrderView,
  reason: string,
): Promise<boolean> {
  if (!(await deps.repo.markGrantFailed(order.tradeNo))) return false;
  // ⚠️ 这条 WARN 是「到账异常」**唯一**能被看见的地方：没有它，这个状态只是
  //    把「发放失败」换了个名字，日志里什么也查不到。四个字段是排查的最小集：
  //    拿 trade_no 去网关/我们的订单表对，拿 user_id 去联系用户，金额对账，
  //    持有分钟数说明这事拖了多久。
  deps.logger.warn(
    `到账异常：钱已到账但积分反复发放失败，已转入人工核验 `
      + `tradeNo=${order.tradeNo} userId=${order.userId} `
      + `金额=${order.amountFen / 100} 元 持有=${heldMinutes(order)} 分钟 `
      + `原因=${reason}`,
    {
      event: "recharge.grant_failed",
      trade_no: order.tradeNo,
      user_id: order.userId,
      amount_fen: order.amountFen,
      held_minutes: heldMinutes(order),
    },
  );
  return true;
}

/**
 * 报出「已超重试窗口、不再重试」的那批单。
 *
 * <p>⚠️ 与 `recharge.grant_failed`（只在状态**第一次**被标记那轮打）不同，这条 WARN
 * **每轮都会打**（只要超窗的单还在）。这不是疏忽：
 *   · 上面那条是「一次失败」的信号，重试会继续，所以重复叫人是噪声；
 *   · 这条是「**一个已经停下来的钱**」的信号 —— 它不会自己好，只会等人处理，而库里
 *     没有任何一列能表示这件事（超窗不是状态、也没有「放弃」状态）。少打一轮，这堆单
 *     就从「每 5 分钟被提醒一次」变成「悄悄没人管了」，正是这条规则要防的那件事。
 *   所以：条数不变也是它该有的样子，直到有人把那些单处理掉（补发/退款）为止。
 *
 * <p>样本走结构化字段（`sample_N_*`）。`LogExtras` 只收 `string | number`，装不下数组，
 * 用平铺的带序号键是这里唯一能让 TLS 侧按字段检索的做法。
 */
function reportAbandoned(
  logger: Logger,
  abandoned: AbandonedGrants,
  retryWindowMs: number,
): void {
  const fields: Record<string, string | number> = {
    event: "recharge.grant_retry_exhausted",
    count: abandoned.total,
    window_minutes: Math.round(retryWindowMs / 60_000),
  };
  const parts: string[] = [];
  abandoned.samples.forEach((order, index) => {
    const n = index + 1;
    const held = heldMinutes(order);
    fields[`sample_${n}_trade_no`] = order.tradeNo;
    fields[`sample_${n}_user_id`] = order.userId;
    fields[`sample_${n}_amount_fen`] = order.amountFen;
    fields[`sample_${n}_held_minutes`] = held;
    parts.push(
      `sample${n}(tradeNo=${order.tradeNo} userId=${order.userId} `
        + `金额=${order.amountFen / 100} 元 已等=${held} 分钟)`,
    );
  });
  logger.warn(
    `到账异常已停止重试：钱已到账但积分始终没发出去，且已超过 ${Math.round(retryWindowMs / 60_000)} 分钟`
      + `重试窗口，共 ${abandoned.total} 笔不再自动重试（需人工补发或退款）`
      + `${abandoned.total > abandoned.samples.length
        ? `，以下为最早的 ${abandoned.samples.length} 笔：`
        : "："}`
      + parts.join(" "),
    fields,
  );
}
