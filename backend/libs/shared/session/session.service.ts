import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { Redis } from "ioredis";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";

/** 会话 7 天滑动过期（Redis TTL）。 */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** role/status 距上次复核超过该时长则回源 new-api 复核（账户禁用/降权近实时生效）。 */
const ROLE_STATUS_RECHECK_MS = 5 * 60 * 1000;

export interface ResolvedSession {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  /** 上游执行凭证（sk-，修正四：明文），AuthGuard 回注请求头代打 new-api。 */
  sk: string;
  /** role/status 是否已过期、需要回源 new-api 复核。 */
  needsRecheck: boolean;
}

type SessionPayload = {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  /** 上游 sk-（修正四：明文存 Redis，不再 AES 密封）。 */
  sk: string;
  /** role/status 最近一次回源 new-api 复核的时间戳（ms）。 */
  verifiedAt: number;
};

/**
 * 登录态会话（ADR-0062 #19 凭证分层）。浏览器只持 HttpOnly 会话 cookie 里的 `sess_` 令牌，
 * 会话映射存 Redis（7 天滑动 TTL），上游 sk- 明文随会话存放（修正四：去密），供 BFF 回注请求头代打 new-api。
 */
@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
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

  /** 按用户索引键：冻结时据此枚举该用户全部会话并批量吊销（TTL 与会话键同写同续）。 */
  private indexKey(userId: number, hash: string): string {
    return `user_session:${userId}:${hash}`;
  }

  /** 写会话（sk- 明文存 Redis，修正四），返回下发给浏览器的会话令牌。 */
  async createSession(input: {
    userId: number;
    username: string;
    role: number;
    status: number;
    email: string | null;
    sk: string;
  }): Promise<string> {
    const token = `sess_${randomBytes(32).toString("base64url")}`;
    const hash = this.hashOf(token);
    const payload: SessionPayload = {
      userId: input.userId,
      username: input.username,
      role: input.role,
      status: input.status,
      email: input.email,
      sk: input.sk,
      verifiedAt: Date.now(),
    };
    // 会话键 + 按用户索引键同写同 TTL（EX），冻结时可枚举该用户全部会话。
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
    return token;
  }

  /** 校验并解析会话；不存在或已过期返回 null。每次访问滑动续期 7 天。 */
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
    // 滑动续期同时以 SET 覆盖索引（值恒定）：既给已建索引续 TTL，
    // 也给部署前旧会话（无索引键）惰性补建，使其纳入冻结枚举范围。
    await this.redis.set(
      this.indexKey(data.userId, this.hashOf(token)),
      "1",
      "EX",
      SESSION_TTL_SECONDS,
    );
    let sk: string;
    try {
      if (typeof data.sk !== "string" || data.sk.length === 0) {
        throw new Error("会话凭证缺失");
      }
      sk = data.sk;
    } catch {
      // 凭证缺失/损坏：会话不可用，删除并要求重新登录（而非 503）。
      await this.redis.del(key);
      return null;
    }
    return {
      userId: data.userId,
      username: data.username,
      role: data.role,
      status: data.status,
      email: data.email,
      sk,
      needsRecheck: Date.now() - data.verifiedAt > ROLE_STATUS_RECHECK_MS,
    };
  }

  /** 复核后回写 role/status 与 verifiedAt（AuthGuard 每 ROLE_STATUS_RECHECK_MS 触发）。 */
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
      // 复核回写同样以 SET 覆盖索引（值恒定）：续 TTL + 兜底补建，保持与会话键同寿命。
      await this.redis.set(
        this.indexKey(data.userId, this.hashOf(token)),
        "1",
        "EX",
        SESSION_TTL_SECONDS,
      );
    } catch {
      // 解析失败静默忽略：下次 resolve 仍会触发复核
    }
  }

  /** 登出吊销：删除会话（上游 sk- 不动，普通登出与凭证轮换分离，ADR-0062 #10/#19）。 */
  async revoke(token: string): Promise<void> {
    const key = this.key(token);
    const hash = this.hashOf(token);
    try {
      const { userId } = JSON.parse(
        (await this.redis.get(key)) ?? "{}",
      ) as SessionPayload;
      // 索引键一并删（键不存在时 DEL 为无害 no-op），避免 GET 后并发吊销留下孤儿索引。
      await this.redis.multi().del(key).del(this.indexKey(userId, hash)).exec();
    } catch {
      // 载荷缺失/损坏时兜底只删会话键（索引键交由 TTL 自然过期）
      await this.redis.del(key);
    }
  }

  /** 踢单用户全部会话：按索引枚举并删除会话+索引键，返回枚举到的会话数（供冻结审计）。 */
  async revokeAllForUser(userId: number): Promise<number> {
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
        if (k.startsWith(prefix)) hashes.add(k.slice(prefix.length));
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
