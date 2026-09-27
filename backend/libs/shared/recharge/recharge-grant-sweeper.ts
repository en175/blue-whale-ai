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
 *      各记各的内存等于没限流。抢不到 = 别的副本这几分钟内已经在管这一笔了，跳过它；
 *   2. 再调一次发放（`retryGrant`，即 `RechargeService.fulfill`：先置待到账 → 发放 → 置到账）。
 *      幂等由 billing 的 `purchased:{tradeNo}` 键兜底，重复调用不会重复发积分；
 *   3. 仍失败就标 `grant_failed` 并**打一条结构化 WARN**，让人能去查。
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
 * （见 `RechargeOrderRepo.listUnsettledBefore`），只是**不再重复叫人**：
 * WARN 只在「本次由我标记」那一次打（`markGrantFailed` 的返回值正是这个意思），
 * 之后的每轮重试失败记 info —— 否则一个卡住的单会每 5 分钟朝日志里喊一次。
 * ============================================ */
import type { Logger } from "@lib/core/logging";
import type { RechargeOrderRepo, RechargeOrderView } from "@lib/shared/persistence/index.js";

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
}

export interface GrantSweeperDeps {
  repo: Pick<
    RechargeOrderRepo,
    "listUnsettledBefore" | "claimQuerySlot" | "markGrantFailed"
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
): (options: { batchSize?: number; claimMs: number }) => Promise<GrantSweepResult> {
  return async function sweepStaleGrants(options) {
    const batchSize = options.batchSize ?? GRANT_SWEEP_BATCH_SIZE;
    const stale = await deps.repo.listUnsettledBefore(
      new Date(Date.now() - GRANT_STALE_AFTER_MS),
      batchSize,
    );

    let healed = 0;
    let flagged = 0;
    let stillFailing = 0;
    let skipped = 0;
    for (const order of stale) {
      try {
        if (!(await deps.repo.claimQuerySlot(order.tradeNo, options.claimMs))) {
          skipped += 1;
          continue;
        }
        await deps.retryGrant(order);
        healed += 1;
        deps.logger.info(
          `主动对账补发成功 tradeNo=${order.tradeNo} userId=${order.userId} `
            + `金额=${order.amountFen / 100} 元 持有=${heldMinutes(order)} 分钟`,
        );
      } catch (error) {
        // markGrantFailed 的返回值就是「本次是否由我把它标成异常」：
        // 只有那一次才值得叫人，之后的每轮重试失败都只是「还是没发出去」。
        if (await deps.repo.markGrantFailed(order.tradeNo)) {
          flagged += 1;
          // ⚠️ 这条 WARN 是「到账异常」**唯一**能被看见的地方：没有它，这个状态只是
          //    把「发放失败」换了个名字，日志里什么也查不到。四个字段是排查的最小集：
          //    拿 trade_no 去网关/我们的订单表对，拿 user_id 去联系用户，金额对账，
          //    持有分钟数说明这事拖了多久。
          deps.logger.warn(
            `到账异常：钱已到账但积分反复发放失败，已转入人工核验 `
              + `tradeNo=${order.tradeNo} userId=${order.userId} `
              + `金额=${order.amountFen / 100} 元 持有=${heldMinutes(order)} 分钟 `
              + `原因=${error instanceof Error ? error.message : String(error)}`,
            {
              event: "recharge.grant_failed",
              trade_no: order.tradeNo,
              user_id: order.userId,
              amount_fen: order.amountFen,
              held_minutes: heldMinutes(order),
            },
          );
        } else {
          stillFailing += 1;
          deps.logger.info(
            `到账异常单重试仍失败 tradeNo=${order.tradeNo} 持有=${heldMinutes(order)} 分钟：`
              + `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    const result = { scanned: stale.length, healed, flagged, stillFailing, skipped };
    // 每轮一条心跳指标（info 级 JSON 行，TLS 侧可聚合）：定时任务最怕的不是报错，
    // 是**静默没跑** —— 一行都搜不到才是最难查的那种故障。
    // 字段名手写成 snake_case：这条会进 TLS 索引，驼峰在这里是本仓明确不要的口径
    deps.logger.metric({
      event: "recharge.grant_sweep",
      fields: {
        scanned: result.scanned,
        healed,
        flagged,
        still_failing: stillFailing,
        skipped,
      },
    });
    return result;
  };
}
