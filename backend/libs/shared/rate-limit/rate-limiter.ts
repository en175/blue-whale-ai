import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "./redis-connection.js";

export type RateLimitTakeInput = {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitTakeResult = {
  allowed: boolean;
  retryAfter?: number;
};

const INCR_EXPIRE = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n
`;

@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  async take(input: RateLimitTakeInput): Promise<RateLimitTakeResult> {
    try {
      if ((await this.redis.exists(this.blockKey(input.scope, input.key))) === 1) {
        return {
          allowed: false,
          retryAfter: await this.retryAfterSeconds(this.blockKey(input.scope, input.key)),
        };
      }
      const windowSec = Math.max(1, Math.ceil(input.windowMs / 1000));
      const windowId = Math.floor(Date.now() / 1000 / windowSec);
      const countKey = this.countKey(input.scope, input.key, windowSec, windowId);
      const count = Number(
        await this.redis.eval(INCR_EXPIRE, 1, countKey, String(windowSec)),
      );
      if (count > input.limit) {
        return {
          allowed: false,
          retryAfter: await this.retryAfterSeconds(countKey),
        };
      }
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }

  async reset(scope: string, key: string, windowMs?: number): Promise<void> {
    try {
      const keys = [this.blockKey(scope, key)];
      if (windowMs != null) {
        const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
        const windowId = Math.floor(Date.now() / 1000 / windowSec);
        keys.push(this.countKey(scope, key, windowSec, windowId));
      }
      await this.redis.del(...keys);
    } catch {
    }
  }

  async block(scope: string, key: string, durationMs: number): Promise<void> {
    try {
      const ttlSec = Math.max(1, Math.ceil(durationMs / 1000));
      await this.redis.set(this.blockKey(scope, key), "1", "EX", ttlSec);
    } catch {
    }
  }

  async isBlocked(scope: string, key: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.blockKey(scope, key))) === 1;
    } catch {
      return false;
    }
  }

  private countKey(
    scope: string,
    key: string,
    windowSec: number,
    windowId: number,
  ): string {
    return `rl:${scope}:${this.identity(key)}:${windowSec}:${windowId}`;
  }

  private blockKey(scope: string, key: string): string {
    return `rlblock:${scope}:${this.identity(key)}`;
  }

  private identity(key: string): string {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  }

  private async retryAfterSeconds(redisKey: string): Promise<number> {
    const ttlMs = await this.redis.pttl(redisKey);
    if (ttlMs < 0) return 1;
    return Math.max(1, Math.ceil(ttlMs / 1000));
  }
}
