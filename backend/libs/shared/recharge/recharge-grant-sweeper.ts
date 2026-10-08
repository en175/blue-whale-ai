import type { Logger } from "@lib/core/logging";
import type {
  AbandonedGrants,
  RechargeOrderRepo,
  RechargeOrderView,
} from "@lib/shared/persistence/index.js";

export const GRANT_STALE_AFTER_MS = 30 * 60 * 1000;

export const GRANT_SWEEP_BATCH_SIZE = 200;

export const GRANT_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;

export function resolveGrantRetryWindowMs(
  raw: string | undefined,
  logger: Logger,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > GRANT_STALE_AFTER_MS) return parsed;
  if (raw !== undefined && raw.trim() !== "") {
    logger.warn(
      `主动对账重试窗口配置非法（RECHARGE_GRANT_RETRY_WINDOW_MS=${raw}）：`
        + `必须大于判定阈值 ${GRANT_STALE_AFTER_MS} 毫秒，否则一轮都不会重试；`
        + `已退回默认值 ${GRANT_RETRY_WINDOW_MS} 毫秒`,
    );
  }
  return GRANT_RETRY_WINDOW_MS;
}

export const GRANT_RETRY_WINDOW_MS_TOKEN = Symbol("GRANT_RETRY_WINDOW_MS");

export const GRANT_ABANDONED_SAMPLE_SIZE = 5;

export interface GrantSweepResult {
  scanned: number;
  healed: number;
  flagged: number;
  stillFailing: number;
  skipped: number;
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
  retryGrant: (order: RechargeOrderView) => Promise<void>;
  logger: Logger;
}

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
    const now = Date.now();
    const staleBefore = new Date(now - GRANT_STALE_AFTER_MS);
    const windowStart = new Date(now - retryWindowMs);

    const stale = await deps.repo.listGrantsToRetry({ staleBefore, windowStart }, batchSize);

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
    deps.logger.metric({
      event: "recharge.grant_sweep",
      fields: {
        scanned: result.scanned,
        healed: counts.healed,
        flagged: counts.flagged,
        still_failing: counts.stillFailing,
        skipped: counts.skipped,
        abandoned: result.abandoned,
      },
    });
    return result;
  };
}

interface RetryCounts {
  healed: number;
  flagged: number;
  stillFailing: number;
  skipped: number;
}

async function retryEach(
  deps: GrantSweeperDeps,
  stale: RechargeOrderView[],
  claimMs: number,
): Promise<RetryCounts> {
  const counts: RetryCounts = { healed: 0, flagged: 0, stillFailing: 0, skipped: 0 };
  for (const order of stale) {
    try {
      if (!(await deps.repo.claimQuerySlot(order.tradeNo, claimMs))) {
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

const NOT_CLAIMED_REASON =
  "本轮没抢到补发名额（用户轮询或其他副本正在处理这一笔），没探到补发结果";

async function flagGrantFailed(
  deps: GrantSweeperDeps,
  order: RechargeOrderView,
  reason: string,
): Promise<boolean> {
  if (!(await deps.repo.markGrantFailed(order.tradeNo))) return false;
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
