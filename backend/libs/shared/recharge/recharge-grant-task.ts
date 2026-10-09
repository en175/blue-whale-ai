import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createLogger, type Logger } from "@lib/core/logging";
import {
  GRANT_RETRY_WINDOW_MS,
  GRANT_RETRY_WINDOW_MS_TOKEN,
  GRANT_SWEEP_BATCH_SIZE,
  type GrantSweepResult,
} from "./recharge-grant-sweeper.js";
import { RechargeService } from "./recharge.service.js";

export const DEFAULT_GRANT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const DEFAULT_GRANT_SWEEP_INITIAL_DELAY_MS = 60 * 1000;

export const DEFAULT_GRANT_SWEEP_BATCH_SIZE = GRANT_SWEEP_BATCH_SIZE;

export const DEFAULT_GRANT_RETRY_WINDOW_MS = GRANT_RETRY_WINDOW_MS;

export const DEFAULT_GRANT_SWEEP_ENABLED = true;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
  private running = false;
  private inflight: Promise<void> = Promise.resolve();

  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly recharge: RechargeService,
    @Inject(GRANT_RETRY_WINDOW_MS_TOKEN) private readonly retryWindowMs: number,
  ) {
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
  }

  onModuleInit(): void {
    if (!this.enabled) {
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
      this.intervalTimer.unref?.();
    }, this.initialDelayMs);
    this.startTimer.unref?.();
    this.logger.info(
      `主动对账已启动：首次 ${Math.round(this.initialDelayMs / 1000)} 秒后、`
        + `此后每 ${Math.round(this.intervalMs / 1000)} 秒一轮，每轮最多 ${this.batchSize} 笔，`
        + `重试窗口 ${Math.round(this.retryWindowMs / 60_000)} 分钟（超窗只报不再试）`,
    );
  }

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
      this.running = false;
    }
  }
}
