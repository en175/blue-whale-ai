import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { issueAccessToken, verifyAccessToken, type AccessTokenClaims } from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import { sessionJwtSecret } from "./jwt-secret.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ROLE_STATUS_RECHECK_MS = 5 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 4;

export function normalizeClientId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 64 ? trimmed : undefined;
}

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

type Member = {
  hash: string;
  clientId?: string | undefined;
};

type IndexEntry = {
  hash: string;
  createdAt: number;
  clientId?: string | undefined;
};

function encodeMember(member: Member): string {
  return JSON.stringify({
    hash: member.hash,
    ...(member.clientId ? { clientId: member.clientId } : {}),
  });
}

function decodeMember(raw: string): Member | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Member>;
    if (typeof parsed.hash !== "string") return null;
    return {
      hash: parsed.hash,
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

  private orderedKey(userId: number): string {
    return `user_sessions:${userId}`;
  }

  private evictedKey(hash: string): string {
    return `session_evicted:${hash}`;
  }

  private async listIndexed(userId: number): Promise<IndexEntry[]> {
    const raw = await this.redis.zrange(this.orderedKey(userId), 0, -1, "WITHSCORES");
    const entries: IndexEntry[] = [];
    for (let index = 0; index + 1 < raw.length; index += 2) {
      const member = decodeMember(raw[index] ?? "");
      if (!member) continue;
      entries.push({
        hash: member.hash,
        clientId: member.clientId,
        createdAt: Number(raw[index + 1]),
      });
    }
    return entries;
  }

  private async addIndexed(
    userId: number,
    hash: string,
    createdAt: number,
    clientId?: string | undefined,
    ttlMs: number = SESSION_TTL_MS,
  ): Promise<void> {
    const key = this.orderedKey(userId);
    await this.redis.zadd(key, String(createdAt), encodeMember({ hash, clientId }));
    await this.redis.pexpire(key, Math.max(1, ttlMs));
  }

  private async removeIndexed(userId: number, hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    const targets = new Set(hashes);
    const members = await this.redis.zrange(this.orderedKey(userId), 0, -1);
    const toRemove = members.filter((raw) => {
      const member = decodeMember(raw);
      return member != null && targets.has(member.hash);
    });
    if (toRemove.length > 0) {
      await this.redis.zrem(this.orderedKey(userId), ...toRemove);
    }
  }

  private async dropSessions(
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
    await this.removeIndexed(userId, hashes);
  }

  private async evictSessions(
    userId: number,
    hashes: readonly string[],
  ): Promise<void> {
    if (hashes.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const hash of hashes) {
      pipeline.set(this.evictedKey(hash), "1", "PX", SESSION_TTL_MS);
      pipeline.del(`session:${hash}`);
      pipeline.del(this.indexKey(userId, hash));
    }
    await pipeline.exec();
    await this.removeIndexed(userId, hashes);
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
      clientId?: unknown | undefined;
    },
  ): Promise<void> {
    const hash = this.hashOf(token);
    const createdAt = Date.now();
    const clientId = normalizeClientId(input.clientId);

    if (clientId) {
      const sameBrowser = (await this.listIndexed(input.userId)).filter(
        (item) => item.clientId === clientId,
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
      .set(this.key(token), JSON.stringify(payload), "PX", SESSION_TTL_MS)
      .set(
        this.indexKey(input.userId, hash),
        JSON.stringify({ createdAt, clientId }),
        "PX",
        SESSION_TTL_MS,
      )
      .exec();
    await this.addIndexed(input.userId, hash, createdAt, clientId);

    const entries = await this.listIndexed(input.userId);
    if (entries.length > MAX_SESSIONS_PER_USER) {
      const oldest = entries
        .sort((left, right) => left.createdAt - right.createdAt)
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
    await this.repairIndexes(token, data);
    return {
      userId: data.userId,
      username: data.username,
      role: data.role,
      status: data.status,
      email: data.email,
      needsRecheck: Date.now() - data.verifiedAt > ROLE_STATUS_RECHECK_MS,
    };
  }

  private async repairIndexes(token: string, data: SessionPayload): Promise<void> {
    const hash = this.hashOf(token);
    const member = encodeMember({ hash, clientId: data.clientId });
    const memberScore = await this.redis.zscore(this.orderedKey(data.userId), member);
    if (memberScore == null) {
      const ttlMs = await this.redis.pttl(this.key(token));
      if (ttlMs > 0) {
        await this.addIndexed(data.userId, hash, data.createdAt ?? 0, data.clientId, ttlMs);
      }
    }
    const indexKey = this.indexKey(data.userId, hash);
    if ((await this.redis.exists(indexKey)) === 0) {
      const ttlMs = await this.redis.pttl(this.key(token));
      if (ttlMs > 0) {
        await this.redis.set(
          indexKey,
          JSON.stringify({ createdAt: data.createdAt ?? 0, clientId: data.clientId }),
          "PX",
          ttlMs,
        );
      }
    }
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
      if (typeof userId === "number") {
        await this.removeIndexed(userId, [hash]);
      }
    } catch {
      await this.redis.del(key);
    }
  }

  async revokeAllForUser(userId: number, exceptToken?: string | undefined): Promise<number> {
    const keepHash = exceptToken ? this.hashOf(exceptToken) : null;
    const targets = new Set(
      (await this.listIndexed(userId))
        .map((item) => item.hash)
        .filter((hash) => hash !== keepHash),
    );
    const prefix = this.indexPrefix(userId);
    let cursor = "0";
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
        const hash = key.slice(prefix.length);
        if (hash !== keepHash) targets.add(hash);
      }
    } while (cursor !== "0");
    if (targets.size === 0) return 0;
    await this.dropSessions(userId, [...targets]);
    return targets.size;
  }
}
