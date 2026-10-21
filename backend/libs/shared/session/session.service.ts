import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { issueAccessToken, verifyAccessToken, type AccessTokenClaims } from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import { sessionJwtSecret } from "./jwt-secret.js";

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ROLE_STATUS_RECHECK_MS = 5 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 3;

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
  createdAt: number;
  clientId?: string | undefined;
};

type IndexEntry = {
  createdAt: number;
  clientId?: string | undefined;
};

function encodeIndex(entry: IndexEntry): string {
  return JSON.stringify(entry);
}

function decodeIndex(raw: string | null): IndexEntry | null {
  if (!raw) return null;
  if (raw === "1") return { createdAt: 0, clientId: undefined };
  try {
    const parsed = JSON.parse(raw) as Partial<IndexEntry>;
    if (typeof parsed.createdAt !== "number") return null;
    return {
      createdAt: parsed.createdAt,
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
    };
  } catch {
    return null;
  }
}

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

  private indexPrefix(userId: number): string {
    return `user_session:${userId}:`;
  }

  private async listIndexEntries(
    userId: number,
  ): Promise<Array<{ hash: string; entry: IndexEntry }>> {
    const prefix = this.indexPrefix(userId);
    let cursor = "0";
    const entries: Array<{ hash: string; entry: IndexEntry }> = [];
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${prefix}*`,
        "COUNT",
        100,
      );
      cursor = next;
      for (const key of keys) {
        if (!key.startsWith(prefix)) continue;
        const entry = decodeIndex(await this.redis.get(key));
        if (entry) entries.push({ hash: key.slice(prefix.length), entry });
      }
    } while (cursor !== "0");
    return entries;
  }

  private async dropUserSessions(
    userId: number,
    hashes: readonly string[],
  ): Promise<void> {
    if (hashes.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const hash of hashes) {
      pipeline.del(`session:${hash}`);
      pipeline.del(this.indexKey(userId, hash));
    }
    await pipeline.exec();
  }

  private async evictSessions(
    userId: number,
    hashes: readonly string[],
  ): Promise<void> {
    if (hashes.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const hash of hashes) {
      pipeline.set(this.evictedKey(hash), "1", "EX", SESSION_TTL_SECONDS);
      pipeline.del(`session:${hash}`);
      pipeline.del(this.indexKey(userId, hash));
    }
    await pipeline.exec();
  }

  private evictedKey(hash: string): string {
    return `session_evicted:${hash}`;
  }

  async wasEvicted(token: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.evictedKey(this.hashOf(token)))) === 1;
    } catch {
      return false;
    }
  }

  async createSession(
    token: string,
    input: {
      userId: number;
      username: string;
      role: number;
      status: number;
      email: string | null;
      clientId?: string | undefined;
    },
  ): Promise<void> {
    const hash = this.hashOf(token);
    const createdAt = Date.now();
    const clientId =
      typeof input.clientId === "string" && input.clientId.trim().length > 0
        ? input.clientId.trim()
        : undefined;

    if (clientId) {
      const sameBrowser = (await this.listIndexEntries(input.userId)).filter(
        (item) => item.entry.clientId === clientId,
      );
      await this.evictSessions(
        input.userId,
        sameBrowser.map((item) => item.hash),
      );
    }

    const payload: SessionPayload = {
      userId: input.userId,
      username: input.username,
      role: input.role,
      status: input.status,
      email: input.email,
      verifiedAt: createdAt,
      createdAt,
      clientId,
    };

    await this.redis
      .multi()
      .set(this.key(token), JSON.stringify(payload), "EX", SESSION_TTL_SECONDS)
      .set(
        this.indexKey(input.userId, hash),
        encodeIndex({ createdAt, clientId }),
        "EX",
        SESSION_TTL_SECONDS,
      )
      .exec();

    const entries = await this.listIndexEntries(input.userId);
    if (entries.length > MAX_SESSIONS_PER_USER) {
      const oldest = entries
        .sort((left, right) => left.entry.createdAt - right.entry.createdAt)
        .slice(0, entries.length - MAX_SESSIONS_PER_USER)
        .map((item) => item.hash);
      await this.evictSessions(input.userId, oldest);
    }
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
    const indexKey = this.indexKey(data.userId, this.hashOf(token));
    if ((await this.redis.exists(indexKey)) === 0) {
      const ttlMs = await this.redis.pttl(key);
      if (ttlMs > 0) {
        await this.redis.set(
          indexKey,
          encodeIndex({ createdAt: data.createdAt ?? 0, clientId: data.clientId }),
          "PX",
          ttlMs,
        );
      }
    }
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
      await this.redis.set(key, JSON.stringify(data), "KEEPTTL");
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
    const entries = (await this.listIndexEntries(userId)).filter(
      (item) => item.hash !== keepHash,
    );
    if (entries.length === 0) return 0;
    await this.dropUserSessions(
      userId,
      entries.map((item) => item.hash),
    );
    return entries.length;
  }
}
