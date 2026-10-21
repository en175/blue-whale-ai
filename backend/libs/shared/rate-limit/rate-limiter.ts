import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
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

const SLIDING_WINDOW = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = window
  if first[2] then retry = window - (now - tonumber(first[2])) end
  return {0, retry}
end
redis.call('ZADD', KEYS[1], now, ARGV[4])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
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
      const now = Date.now();
      const member = `${now}-${randomBytes(6).toString("hex")}`;
      const result = (await this.redis.eval(
        SLIDING_WINDOW,
        1,
        this.countKey(input.scope, input.key),
        String(now),
        String(input.windowMs),
        String(input.limit),
        member,
      )) as [number, number];
      const [allowed, retryMs] = result;
      if (!allowed) {
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil(Number(retryMs) / 1000)),
        };
      }
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }

  async reset(scope: string, key: string, _windowMs?: number): Promise<void> {
    try {
      await this.redis.del(this.blockKey(scope, key), this.countKey(scope, key));
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

  private countKey(scope: string, key: string): string {
    return `rl:${scope}:${this.identity(key)}`;
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
