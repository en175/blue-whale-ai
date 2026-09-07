import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";
import { RateLimiter } from "./rate-limiter.js";

export const LOGIN_FAILURE_SCOPE = "login_failure";
export const LOGIN_LOCK_SCOPE = "login_lock";

export type LoginFailureTrackerOptions = {
  threshold: number;
  windowMs: number;
  blockMs: number;
};

const DEFAULT_OPTIONS: LoginFailureTrackerOptions = {
  threshold: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
};

/** 登录失败计数；达阈值后 block，并通知订阅方（登录工单接入）。 */
@Injectable()
export class LoginFailureTracker extends EventEmitter {
  private options: LoginFailureTrackerOptions = DEFAULT_OPTIONS;

  constructor(private readonly limiter: RateLimiter) {
    super();
  }

  /** 登录工单可覆盖默认阈值 / 窗口 / 锁定时长。 */
  configure(options: LoginFailureTrackerOptions): void {
    this.options = options;
  }

  onBlocked(listener: (account: string) => void): this {
    return this.on("blocked", listener);
  }

  async recordFailure(account: string): Promise<{ locked: boolean }> {
    const result = await this.limiter.take({
      scope: LOGIN_FAILURE_SCOPE,
      key: account,
      // take 在 count > limit 时拒绝：limit=threshold-1 → 第 threshold 次失败锁定。
      limit: Math.max(0, this.options.threshold - 1),
      windowMs: this.options.windowMs,
    });
    if (result.allowed) return { locked: false };
    await this.limiter.block(LOGIN_LOCK_SCOPE, account, this.options.blockMs);
    this.emit("blocked", account);
    return { locked: true };
  }

  async clear(account: string): Promise<void> {
    await this.limiter.reset(LOGIN_FAILURE_SCOPE, account, this.options.windowMs);
    await this.limiter.reset(LOGIN_LOCK_SCOPE, account);
  }
}
