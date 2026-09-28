/* ============================================
 * 「补发已超出重试窗口」那条 WARN 的**频次闸**（M-1，2026-09-27）。
 *
 * ── 它防的是什么 ──────────────────────────────────────────────────────────────
 *
 * 那条 WARN 由**用户轮询**触发（`RechargeService.retryFulfill`），而同一条路径上的
 * `claimQuerySlot` 名额是 30 秒（`RECONCILE_INTERVAL_MS`）。于是：用户只要开着充值页且
 * 账上有一笔超窗单，就是 **≈2880 条/天/副本** —— 比主动对账扫描器高两个量级
 * （扫描器那条超窗 WARN 是**一轮一次**，默认 5 分钟一轮）。
 *
 * 一条只会重复自己、且不会自愈的 WARN 被刷爆之后，真正的信号反而读不出来：
 * 没人会去翻一页 2880 行、每行都一样的日志。
 *
 * ── 闸门放在哪 ────────────────────────────────────────────────────────────────
 *
 * 按 `tradeNo` 去重 + **冷却窗口**（不是「一辈子只打一次」）：
 *   · 同一笔单在冷却窗口内只打一条 —— 频次从「每 30 秒」压到「每窗口一次」；
 *   · 但过了窗口**还会再打**：超窗这件事不会自己好，一笔被忘掉的单比一笔吵的单更糟。
 *     冷却取值明显大于扫描器的一轮（默认 6 小时），所以它不是新的噪声源。
 *
 * ⚠️ 闸门是**进程内**的，多副本各记各的（N 个副本最多 N 条）。刻意不为它引入持久化：
 * 这只是日志频次，不是判定 —— 订单状态一个都不依赖它（超窗本来就不改状态）。
 *
 * ⚠️ 可见性**不靠这条 WARN 兜底**：超窗的笔数另外有扫描器那条聚合 WARN
 * (`recharge.grant_retry_exhausted`，带 count + 样本) 与心跳指标里的 `abandoned` 字段。
 * 所以这里压频次不会让「有一堆钱卡住了」变得看不见。
 * ============================================ */

/**
 * 同一笔单的两条「已超窗」WARN 之间至少隔多久（默认 6 小时）。
 *
 * <p>取 6 小时而不是「一轮」（扫描器 5 分钟）：用户轮询这条路上「一轮」根本不存在
 * ——它是被用户的手速驱动的。6 小时 = 单笔每天最多 4 条，比 2880 条低三个量级，
 * 同时仍然**每天**提醒一次「这笔还没处理」。
 */
export const GRANT_WINDOW_WARN_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface GrantWindowWarnGate {
  /** 这一笔**现在**该不该打那条 WARN（true = 打，调用方随即打；false = 冷却中/没超窗） */
  shouldWarn(tradeNo: string): boolean;
  /** 正在冷却的单数（测试与观测用：它必须是**有界**的，见模块头） */
  size(): number;
}

export function createGrantWindowWarnGate(
  cooldownMs: number = GRANT_WINDOW_WARN_COOLDOWN_MS,
): GrantWindowWarnGate {
  const lastWarnAt = new Map<string, number>();
  return {
    shouldWarn(tradeNo) {
      const now = Date.now();
      // 顺手清掉已过冷却的条目：不清的话这张表随着「历史上超过窗的单」无限长，
      // 而它本来只该记得「最近一个窗口内打过谁」。清完再判，冷却语义才是准的。
      for (const [key, at] of lastWarnAt) {
        if (now - at >= cooldownMs) lastWarnAt.delete(key);
      }
      if (lastWarnAt.has(tradeNo)) return false;
      lastWarnAt.set(tradeNo, now);
      return true;
    },
    size() {
      return lastWarnAt.size;
    },
  };
}
