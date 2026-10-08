import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { issueAccessToken, verifyAccessToken, type AccessTokenClaims } from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import { sessionJwtSecret } from "./jwt-secret.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ROLE_STATUS_RECHECK_MS = 5 * 60 * 1000;

export interface ResolvedSession {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  needsRecheck: boolean;
}

type SessionPayload = {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  verifiedAt: number;
};

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly jwtSecret: string;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
    this.jwtSecret = sessionJwtSecret();
  }

  async issueToken(userId: string): Promise<string> {
    return issueAccessToken(userId, this.jwtSecret);
  }

  async verifyToken(token: string): Promise<AccessTokenClaims> {
    return verifyAccessToken(token, this.jwtSecret);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private key(token: string): string {
    return `session:${createHash("sha256").update(token).digest("hex")}`;
  }

  private hashOf(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private indexKey(userId: number, hash: string): string {
    return `user_session:${userId}:${hash}`;
  }

  async createSession(
    token: string,
    input: {
      userId: number;
      username: string;
      role: number;
      status: number;
      email: string | null;
    },
  ): Promise<void> {
    const hash = this.hashOf(token);
    const payload: SessionPayload = {
      userId: input.userId,
      username: input.username,
      role: input.role,
      status: input.status,
      email: input.email,
      verifiedAt: Date.now(),
    };
    await this.redis
      .multi()
      .set(this.key(token), JSON.stringify(payload), "EX", SESSION_TTL_SECONDS)
      .set(
        this.indexKey(input.userId, hash),
        "1",
        "EX",
        SESSION_TTL_SECONDS,
      )
      .exec();
  }

  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const key = this.key(token);
    const raw = await this.redis.get(key);
    if (!raw) return null;
    let data: SessionPayload;
    try {
      data = JSON.parse(raw) as SessionPayload;
    } catch {
      await this.redis.del(key);
      return null;
    }
    await this.redis.expire(key, SESSION_TTL_SECONDS);
    await this.redis.set(
      this.indexKey(data.userId, this.hashOf(token)),
      "1",
      "EX",
      SESSION_TTL_SECONDS,
    );
    return {
      userId: data.userId,
      username: data.username,
      role: data.role,
      status: data.status,
      email: data.email,
      needsRecheck: Date.now() - data.verifiedAt > ROLE_STATUS_RECHECK_MS,
    };
  }

  async updateSessionIdentity(
    token: string,
    input: { role: number; status: number },
  ): Promise<void> {
    const key = this.key(token);
    const raw = await this.redis.get(key);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as SessionPayload;
      data.role = input.role;
      data.status = input.status;
      data.verifiedAt = Date.now();
      await this.redis.set(key, JSON.stringify(data), "EX", SESSION_TTL_SECONDS);
      await this.redis.set(
        this.indexKey(data.userId, this.hashOf(token)),
        "1",
        "EX",
        SESSION_TTL_SECONDS,
      );
    } catch {
    }
  }

  async revoke(token: string): Promise<void> {
    const key = this.key(token);
    const hash = this.hashOf(token);
    try {
      const { userId } = JSON.parse(
        (await this.redis.get(key)) ?? "{}",
      ) as SessionPayload;
      await this.redis.multi().del(key).del(this.indexKey(userId, hash)).exec();
    } catch {
      await this.redis.del(key);
    }
  }

  async revokeAllForUser(userId: number, exceptToken?: string | undefined): Promise<number> {
    const keepHash = exceptToken ? this.hashOf(exceptToken) : null;
    const prefix = `user_session:${userId}:`;
    let cursor = "0";
    const hashes = new Set<string>();
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = next;
      for (const k of keys) {
        if (k.startsWith(prefix)) {
          const hash = k.slice(prefix.length);
          if (hash !== keepHash) hashes.add(hash);
        }
      }
    } while (cursor !== "0");
    if (hashes.size === 0) return 0;
    const pipeline = this.redis.pipeline();
    for (const hash of hashes) {
      pipeline.del(`session:${hash}`);
      pipeline.del(this.indexKey(userId, hash));
    }
    await pipeline.exec();
    return hashes.size;
  }
}
