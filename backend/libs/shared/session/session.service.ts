import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import { issueAccessToken, verifyAccessToken, type AccessTokenClaims } from "@lib/core";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import { sessionJwtSecret } from "./jwt-secret.js";

/** 会话 7 天滑动过期（Redis TTL）。 */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** role/status 距上次复核超过该时长则由 AuthGuard 回源**我们自己的身份库**复核（冻结/降权近实时生效）。 */
const ROLE_STATUS_RECHECK_MS = 5 * 60 * 1000;

export interface ResolvedSession {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  /** role/status 是否已过期、需要回源**我们自己的身份库**复核。 */
  needsRecheck: boolean;
}

type SessionPayload = {
  userId: number;
  username: string;
  role: number;
  status: number;
  email: string | null;
  /** role/status 最近一次回源复核的时间戳（ms）。 */
  verifiedAt: number;
};

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly redis: Redis;
  /**
   * 登录凭证的签名密钥（IKJAZL）。
   *
   * <p>**在构造函数里读**：缺失即启动失败，而不是等到第一个人来登录才炸——
   * 那时候它在日志里长得像「登录坏了」，排查要先绕一圈才想到是配置。
   */
  private readonly jwtSecret: string;

  constructor() {
    this.redis = new Redis(redisConnectionOptions());
    this.jwtSecret = sessionJwtSecret();
  }

  /**
   * 签发登录令牌（IKJAZL）。
   *
   * <p>为什么签发收在这里，而不是让调用方各自去调 `@lib/core` 的 JWT 工具：
   * 密钥是**进程级配置**，散到多个调用方就意味着"各处自己读 env、各自处理缺失"，
   * 最后总有一处忘了处理。收敛在一处，缺配置只会在启动时暴露一次。
   */
  async issueToken(userId: string): Promise<string> {
    return issueAccessToken(userId, this.jwtSecret);
  }

  /**
   * 校验登录令牌的签名与有效期。**不查 Redis** —— 那是 {@link resolveSession} 的事。
   *
   * <p>两步分开是刻意的：验签不需要网络（边缘节点也能做），查注销必须回源。
   * 合在一起就会被迫每次都打 Redis。
   */
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

  /** 按用户索引键：冻结时据此枚举该用户全部会话并批量吊销（TTL 与会话键同写同续）。 */
  private indexKey(userId: number, hash: string): string {
    return `user_session:${userId}:${hash}`;
  }

  /**
   * 写会话。**令牌由调用方签发**（IKJAZL：登录凭证是 JWT，签发在 auth 控制器）。
   *
   * <p>⚠️ 这里**不再自己生成令牌**。令牌长什么样（不透明随机串 / JWT）是签发方的事；
   * 会话存储只回答「这个令牌还有效吗、它对应谁」。两边各签一种的形态，正是这次改造
   * 要收拾的东西——那意味着校验方得同时理解两种凭证。
   */
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
    return {
      userId: data.userId,
      username: data.username,
      role: data.role,
      status: data.status,
      email: data.email,
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

  /** 登出吊销：删除会话（普通登出与凭证轮换分离，ADR-0062 #10/#19）。 */
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

  /**
   * 踢单用户全部会话：按索引枚举并删除会话+索引键，返回**实际删掉的**会话数。
   *
   * <p>这个计数有三个消费点：冻结审计、重置密码审计（IKJABH），以及 `/me/password`
   * 响应里那句「已登出其他设备」。
   *
   * @param exceptToken IKJABH：**留下这一个会话**。强制改密场景必须用它——
   *        用户刚登进来、被迫改完密码，如果连当前这条会话一起吊销，他会立刻被踢回
   *        登录页；而他要做的下一件事恰恰是「用新密码重新登录」。自助改密不需要它
   *        （改完重新登录是合理的），所以是可选参数而不是默认行为。
   */
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
