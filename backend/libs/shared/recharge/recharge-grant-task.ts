/* ============================================
 * 主动对账的**定时入口**（#45）：每隔一段时间把「钱到了、积分没发完」的单再推一次。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────────
 *
 * 到账的两条自愈路径（回调重投、用户轮询触发的补发）都**要有人在**：
 *   · 网关的异步通知只重投 6 次（约 15 分钟），过了就不再推；
 *   · `getOrderStatus` 的补发要用户开着页面轮询才会发生。
 * 用户关掉页面之后，一次发放失败的单就再没有任何人来碰它 —— 钱收了、积分永远不发。
 * 本任务补的就是这一段：**没人在看的单也自己好起来**。
 *
 * ── 定时任务在这个仓里怎么开 ──────────────────────────────────────────────────
 *
 * ⚠️ NestJS **没有** Spring 的 `@EnableScheduling`。等价入口是「一个实现了 `OnModuleInit`
 * 的 provider」：Nest 在 `app.init()` 时实例化模块的 providers 并调用它们的生命周期钩子。
 * 本类由 `RechargeLibModule` 注册，而该模块是 `@Global()` 且被
 * `apps/blue-whale/src/app.module.ts` 导入 —— **计时的开关就开在那条导入链上**，
 * 把本 provider 从模块里摘掉，任务就不再跑（没有第二处需要改）。
 *
 * 本仓**不引入 `@nestjs/schedule`**：只为一个任务加一个依赖不划算，而 `libs/core` 里
 * 已经有「自持计时器 + `unref()` + stop 时等在途」的先例（`createQueueDepthSampler`）。
 * 这里照搬那套形状，另加两个 Spring 侧的对应物：`fixedDelay` 语义与「异常必须吞掉」。
 *
 * ── 为什么扫描逻辑不写在这个类里 ──────────────────────────────────────────────
 *
 * 扫描在 `RechargeService.sweepStaleGrants()`：它要 repo、要 `fulfill`、要知道「钱到了」
 * 的判据，这些都是充值域的东西。本类只负责**什么时候跑**与**跑挂了怎么办**，
 * 于是测试与将来的管理端「立刻扫一轮」按钮可以绕过计时器直接调那个方法 —— 同一条路径。
 * ============================================ */
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createLogger, type Logger } from "@lib/core/logging";
import {
  GRANT_RETRY_WINDOW_MS,
  GRANT_STALE_AFTER_MS,
  GRANT_SWEEP_BATCH_SIZE,
  type GrantSweepResult,
} from "./recharge-grant-sweeper.js";
import type { RechargeService } from "./recharge.service.js";

/** 扫描间隔：默认 5 分钟。 */
export const DEFAULT_GRANT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 启动后首次扫描的延迟：默认 1 分钟。
 *
 * <p>和 billing 的 `CatalogReloadTask` 一样**不设 0**：滚动发布时每个新副本一启动就查一次库
 * 没有意义（刚崩掉的副本扫过的单，另一个副本还在扫），等一分钟既避开启动高峰，
 * 又让「启动后任务到底跑没跑」在一分钟内有答案。
 */
export const DEFAULT_GRANT_SWEEP_INITIAL_DELAY_MS = 60 * 1000;

/** 每轮最多处理几笔（默认值取自扫描器，两处不能各写一个数）。 */
export const DEFAULT_GRANT_SWEEP_BATCH_SIZE = GRANT_SWEEP_BATCH_SIZE;

/**
 * 重试窗口：从「钱到账的时刻」起算，最多重试这么久（默认 2 小时，值取自扫描器）。
 *
 * <p>⚠️ 分布式的部署里这个上限必须**小于**「运维会去看一次告警」的周期才有意义 ——
 * 超窗的单不再自动重试，只靠一条 WARN 与心跳里的 `abandoned` 计数说话。
 */
export const DEFAULT_GRANT_RETRY_WINDOW_MS = GRANT_RETRY_WINDOW_MS;

/**
 * 总开关（默认开）。关掉后**没有其他东西会去补发**：网关重投窗口早已过去，
 * 用户不轮询就没人管 —— 关它是在主动放弃「没人看也能自愈」这条保证。
 */
export const DEFAULT_GRANT_SWEEP_ENABLED = true;

/** 读一个正整数环境变量；非法值（空串 / NaN / ≤0）一律退回默认值，不拒启。 */
function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 读重试窗口（毫秒）。它比「正整数」多一条约束：**必须大于 `GRANT_STALE_AFTER_MS`**。
 *
 * <p>窗口不比判定阈值长的话，「够格重试」（早于 30 分钟）与「已超窗」（早于窗口起点）
 * 两个条件的**交集为空** —— 一轮都不会重试，而任务看上去完全正常（心跳在打、日志没有报错）。
 * 这正是本模块最怕的那种故障形态，所以这种取值一律退回默认值，并**吵一声**。
 *
 * <p>仍然**不拒启**：兜底任务不该因为配错一个数字把整个后端拦在启动之外
 * （与 `readPositiveInt` 同一条）。
 */
function readRetryWindowMs(raw: string | undefined, logger: Logger): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && parsed > GRANT_STALE_AFTER_MS) return parsed;
  // 空串等于「没配」，那是正常路径，不吵
  if (raw !== undefined && raw.trim() !== "") {
    logger.warn(
      `主动对账重试窗口配置非法（RECHARGE_GRANT_RETRY_WINDOW_MS=${raw}）：`
        + `必须大于判定阈值 ${GRANT_STALE_AFTER_MS} 毫秒，否则一轮都不会重试；`
        + `已退回默认值 ${DEFAULT_GRANT_RETRY_WINDOW_MS} 毫秒`,
    );
  }
  return DEFAULT_GRANT_RETRY_WINDOW_MS;
}

/** 读一个布尔环境变量：只有显式的 `false` / `0` 关，其余（含未配置）都是开。 */
function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim().toLowerCase();
  return value !== "false" && value !== "0";
}

@Injectable()
export class RechargeGrantReconcileTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger = createLogger("recharge-grant");
  private intervalTimer: NodeJS.Timeout | null = null;
  private startTimer: NodeJS.Timeout | null = null;
  /** 上一轮还没跑完时不再开新的一轮（`fixedDelay` 语义，不是 `fixedRate`：不堆积追赶） */
  private running = false;
  private inflight: Promise<void> = Promise.resolve();

  /**
   * 配置全部走环境变量，**默认值就写在上面那几个常量里**（`RECHARGE_GRANT_*`）。
   *
   * <p>环境变量读不出来（缺失/非法）一律退回默认值而**不拒启**：这是个兜底任务，
   * 它不跑不等于服务不可用，而拒绝启动会让「配错一个数字」升级成「整个后端起不来」。
   */
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly batchSize: number;
  private readonly retryWindowMs: number;

  constructor(private readonly recharge: RechargeService) {
    this.enabled = readBool(
      process.env.RECHARGE_GRANT_SWEEP_ENABLED,
      DEFAULT_GRANT_SWEEP_ENABLED,
    );
    this.intervalMs = readPositiveInt(
      process.env.RECHARGE_GRANT_SWEEP_INTERVAL_MS,
      DEFAULT_GRANT_SWEEP_INTERVAL_MS,
    );
    this.initialDelayMs = readPositiveInt(
      process.env.RECHARGE_GRANT_SWEEP_INITIAL_DELAY_MS,
      DEFAULT_GRANT_SWEEP_INITIAL_DELAY_MS,
    );
    this.batchSize = readPositiveInt(
      process.env.RECHARGE_GRANT_SWEEP_BATCH_SIZE,
      DEFAULT_GRANT_SWEEP_BATCH_SIZE,
    );
    this.retryWindowMs = readRetryWindowMs(
      process.env.RECHARGE_GRANT_RETRY_WINDOW_MS,
      this.logger,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      // 关掉时也要说一声：否则「服务在跑」与「补发在做」会被当成同一件事
      this.logger.warn(
        "主动对账已关闭（RECHARGE_GRANT_SWEEP_ENABLED=false）："
          + "网关重投窗口过后，没有任何人会去补发没人轮询的订单",
      );
      return;
    }
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.tick();
      this.intervalTimer = setInterval(() => void this.tick(), this.intervalMs);
      // 计时器不把进程钉住：容器收到 SIGTERM 时要能退出（与 queue-depth-sampler 同）
      this.intervalTimer.unref?.();
    }, this.initialDelayMs);
    this.startTimer.unref?.();
    this.logger.info(
      `主动对账已启动：首次 ${Math.round(this.initialDelayMs / 1000)} 秒后、`
        + `此后每 ${Math.round(this.intervalMs / 1000)} 秒一轮，每轮最多 ${this.batchSize} 笔，`
        + `重试窗口 ${Math.round(this.retryWindowMs / 60_000)} 分钟（超窗只报不再试）`,
    );
  }

  /**
   * 停机：停掉计时器并**等本轮跑完**。
   *
   * <p>不能只 `clearInterval` 就走：在途的一轮正拿着 Prisma 连接，连接池一关就会以
   * 「连接已关闭」的异常收场，而那笔单的补发结果也就无从记录。
   */
  async onModuleDestroy(): Promise<void> {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    await this.inflight;
  }

  private tick(): Promise<void> {
    if (this.running) {
      this.logger.debug("上一轮主动对账还没跑完，跳过本轮");
      return this.inflight;
    }
    this.inflight = this.sweep();
    return this.inflight;
  }

  /**
   * 跑一轮并把**任何**异常收成日志。
   *
   * <p>⚠️ 异常逃出去会顺着计时器回调变成 `uncaughtException`：轻则进程按 Node 默认策略退出，
   * 重则（如果被别处的 handler 兜住）这个 `setInterval` 自己还活着、但每轮都在同一个地方炸，
   * 表现为「服务一切正常、只是再没有订单被补发过」。与 billing 的 `CatalogReloadTask` /
   * `CreditExpirySweeper` 是同一条纪律：**必须吞掉**，下一轮继续。
   */
  async sweepOnce(): Promise<GrantSweepResult | null> {
    try {
      return await this.recharge.sweepStaleGrants({
        batchSize: this.batchSize,
        claimMs: this.intervalMs,
        retryWindowMs: this.retryWindowMs,
      });
    } catch (error) {
      this.logger.error(
        `主动对账本轮失败（本轮未处理任何订单，${Math.round(this.intervalMs / 1000)} 秒后重试）：`
          + `${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  private async sweep(): Promise<void> {
    this.running = true;
    try {
      await this.sweepOnce();
    } finally {
      // 一定要复位：卡在 true 上等于任务从此再也不跑，而且没有任何报错
      this.running = false;
    }
  }
}
