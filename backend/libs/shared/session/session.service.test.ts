import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService } from "./session.service.js";

const TTL_SECONDS = 7 * 24 * 60 * 60;

/** 内存版 ioredis（按 key 存字符串，记录 expire/set 调用）。vi.hoisted 保证 mock 提升时可见。 */
const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    expiredKeys: string[] = [];
    setKeys: string[] = [];

    constructor(_options?: unknown) {}

    async set(
      key: string,
      value: string,
      _mode?: string,
      _ttl?: number,
    ): Promise<"OK"> {
      // 生产只以「SET key 1 EX ttl」覆盖/补建索引（值恒定、同 TTL），无 NX 分支。
      this.store.set(key, value);
      this.setKeys.push(key);
      return "OK";
    }

    async get(key: string): Promise<string | null> {
      return this.store.get(key) ?? null;
    }

    async del(...keys: string[]): Promise<number> {
      let n = 0;
      for (const k of keys) if (this.store.delete(k)) n += 1;
      return n;
    }

    async expire(key: string, _ttl: number): Promise<number> {
      this.expiredKeys.push(key);
      return 1;
    }

    /** SCAN：支持 MATCH/COUNT 语义，一次返回全部匹配键（测试规模小）。 */
    async scan(
      cursor: string,
      _match: "MATCH",
      pattern: string,
      _count: "COUNT",
      _size: number,
    ): Promise<[string, string[]]> {
      if (cursor !== "0") return ["0", []];
      const re = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      const keys = [...this.store.keys()].filter((k) => re.test(k));
      return ["0", keys];
    }

    /** MULTI/PIPELINE：批量排队后 exec 统一执行。 */
    multi(): {
      set: (k: string, v: string, m?: string, t?: number) => unknown;
      del: (...keys: string[]) => unknown;
      exec: () => Promise<unknown[]>;
    } {
      const ops: Array<[string, unknown[]]> = [];
      const api = {
        set: (k: string, v: string, m?: string, t?: number) => {
          ops.push(["set", [k, v, m, t]]);
          return api;
        },
        del: (...keys: string[]) => {
          ops.push(["del", keys]);
          return api;
        },
        exec: async (): Promise<unknown[]> => {
          const results: unknown[] = [];
          for (const [name, args] of ops) {
            if (name === "set") {
              const [k, v, m, t] = args as [string, string, string, number];
              results.push(await this.set(k, v, m, t));
            } else if (name === "del") {
              results.push(await this.del(...(args as string[])));
            }
          }
          return results;
        },
      };
      return api;
    }

    pipeline(): ReturnType<FakeRedis["multi"]> {
      return this.multi();
    }

    async quit(): Promise<"OK"> {
      return "OK";
    }
  }
  return { FakeRedis };
});

vi.mock("ioredis", () => ({ Redis: FakeRedis }));

const BASE = {
  userId: 8,
  username: "alice",
  role: 1,
  status: 1,
  email: "alice@example.com",
};

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

describe("SessionService（登录态凭证分层，Redis 存储，ADR-0062 #19）", () => {
  let service: SessionService;
  let redis: FakeRedis;

  beforeEach(() => {
    service = new SessionService();
    redis = (service as unknown as { redis: FakeRedis }).redis;
    redis.store.clear();
    redis.expiredKeys = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("createSession 签发 sess_ 令牌，载荷里**没有**上游凭证", async () => {
    const token = await service.createSession(BASE);
    expect(token).toMatch(/^sess_[A-Za-z0-9_-]+$/);
    const raw = [...redis.store.values()][0];
    // 会话只记身份。它曾存过每个用户的 sk-，统一 key 之后变成「给每个用户存同一把 key」——
    // 一份 7 天不过期的密钥副本，且「管理端改了 key」对已登录用户不生效。
    // 现在 key 由 AuthGuard 按当前配置回注，Redis 里不该再有它的任何形态。
    expect(JSON.parse(raw)).not.toHaveProperty("sk");
    // 会话键 + 按用户索引键各一条
    expect(redis.store.size).toBe(2);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(true);
  });

  it("resolveSession 解出身份（round-trip）", async () => {
    const token = await service.createSession(BASE);
    const session = await service.resolveSession(token);
    expect(session).toMatchObject({
      userId: 8,
      username: "alice",
      role: 1,
      status: 1,
      email: "alice@example.com",
    });
    expect(session?.needsRecheck).toBe(false);
  });

  it("★ 部署前的旧会话（载荷里还带 sk）照样可用 —— 退出登录时不该把在线用户全踢掉", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.sk = "sk-legacy-upstream"; // 老版本写下的字段
    redis.store.set(key, JSON.stringify(data));

    const session = await service.resolveSession(token);
    expect(session?.userId).toBe(8);
    expect(session).not.toHaveProperty("sk");
  });

  it("resolveSession 对未知令牌返回 null", async () => {
    expect(await service.resolveSession("sess_unknown")).toBeNull();
  });

  it("resolveSession 每次访问滑动续期（调用 EXPIRE）", async () => {
    const token = await service.createSession(BASE);
    await service.resolveSession(token);
    expect(redis.expiredKeys).toContain(`session:${hash(token)}`);
    // 索引键同步续期（SET 覆盖，保持与会话同寿命）
    expect(redis.setKeys).toContain(`user_session:8:${hash(token)}`);
  });

  it("resolveSession 对部署前旧会话（无索引键）惰性补建索引", async () => {
    const token = await service.createSession(BASE);
    const sessionKey = `session:${hash(token)}`;
    // 模拟部署前旧会话：只有会话键、没有索引键
    redis.store.delete(`user_session:8:${hash(token)}`);

    expect((await service.resolveSession(token))?.userId).toBe(8);
    // 首次 resolve 后索引被补建，冻结枚举可覆盖该会话
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(true);
    expect(await service.revokeAllForUser(8)).toBe(1);
  });

  it("verifiedAt 超时后 needsRecheck=true", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.verifiedAt = Date.now() - 6 * 60 * 1000; // 超过 5 分钟
    redis.store.set(key, JSON.stringify(data));
    expect((await service.resolveSession(token))?.needsRecheck).toBe(true);
  });

  it("updateSessionIdentity 回写 role/status 并重置 verifiedAt", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.verifiedAt = Date.now() - 6 * 60 * 1000;
    redis.store.set(key, JSON.stringify(data));

    await service.updateSessionIdentity(token, { role: 10, status: 0 });
    const after = await service.resolveSession(token);
    expect(after?.role).toBe(10);
    expect(after?.status).toBe(0);
    expect(after?.needsRecheck).toBe(false);
  });

  it("载荷损坏 → 返回 null 并删会话（不 503）", async () => {
    const token = await service.createSession(BASE);
    const key = `session:${hash(token)}`;
    redis.store.set(key, "{ 不是 JSON");
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(key)).toBe(false);
  });

  it("revoke 删除会话与索引（登出吊销）", async () => {
    const token = await service.createSession(BASE);
    await service.revoke(token);
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(`session:${hash(token)}`)).toBe(false);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(false);
  });

  it("revokeAllForUser 删除该用户全部会话并返回计数，不影响其他用户", async () => {
    const a = await service.createSession(BASE);
    const b = await service.createSession(BASE);
    const other = await service.createSession({
      ...BASE,
      userId: 99,
      username: "bob",
    });

    const revoked = await service.revokeAllForUser(8);
    expect(revoked).toBe(2);
    expect(await service.resolveSession(a)).toBeNull();
    expect(await service.resolveSession(b)).toBeNull();
    // 其他用户会话不受影响
    expect(await service.resolveSession(other)).not.toBeNull();
    // 索引同步清空
    expect(redis.store.has(`user_session:8:${hash(a)}`)).toBe(false);
    expect(redis.store.has(`user_session:8:${hash(b)}`)).toBe(false);
    expect(redis.store.has(`user_session:99:${hash(other)}`)).toBe(true);
  });

  it("revokeAllForUser 对零会话用户返回 0", async () => {
    await service.createSession(BASE);
    expect(await service.revokeAllForUser(12345)).toBe(0);
    // 不误删其他用户会话
    expect(await service.resolveSession((await service.createSession(BASE)))).not.toBeNull();
  });
});
