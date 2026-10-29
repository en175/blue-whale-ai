import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService, normalizeClientId } from "./session.service.js";

const { FakeRedis } = vi.hoisted(() => {
  class FakeRedis {
    store = new Map<string, string>();
    zsets = new Map<string, Map<string, number>>();
    ttlMs = new Map<string, number>();
    expiredKeys: string[] = [];
    setKeys: string[] = [];

    constructor(_options?: unknown) {}

    async set(
      key: string,
      value: string,
      mode?: string,
      ttl?: number,
    ): Promise<"OK"> {
      this.store.set(key, value);
      this.setKeys.push(key);
      if (mode === "EX" && ttl != null) this.ttlMs.set(key, ttl * 1000);
      if (mode === "PX" && ttl != null) this.ttlMs.set(key, ttl);
      return "OK";
    }

    async pttl(key: string): Promise<number> {
      if (!this.store.has(key) && !this.zsets.has(key)) return -2;
      return this.ttlMs.get(key) ?? -1;
    }

    async pexpire(key: string, ttlMs: number): Promise<number> {
      this.ttlMs.set(key, ttlMs);
      return 1;
    }

    async exists(key: string): Promise<number> {
      return this.store.has(key) || this.zsets.has(key) ? 1 : 0;
    }

    async get(key: string): Promise<string | null> {
      return this.store.get(key) ?? null;
    }

    private sorted(key: string): Array<[string, number]> {
      return [...(this.zsets.get(key) ?? new Map<string, number>()).entries()].sort(
        (left, right) => left[1] - right[1],
      );
    }

    async zadd(key: string, score: string, member: string): Promise<number> {
      const zset = this.zsets.get(key) ?? new Map<string, number>();
      zset.set(member, Number(score));
      this.zsets.set(key, zset);
      return 1;
    }

    async zrange(
      key: string,
      start: number,
      stop: number,
      mode?: "WITHSCORES",
    ): Promise<string[]> {
      const entries = this.sorted(key);
      const begin = start < 0 ? Math.max(0, entries.length + start) : start;
      const end = stop < 0 ? entries.length + stop + 1 : stop + 1;
      const slice = entries.slice(begin, end);
      return mode === "WITHSCORES"
        ? slice.flatMap(([member, score]) => [member, String(score)])
        : slice.map(([member]) => member);
    }

    async zrem(key: string, ...members: string[]): Promise<number> {
      const zset = this.zsets.get(key);
      if (!zset) return 0;
      let removed = 0;
      for (const member of members) if (zset.delete(member)) removed += 1;
      return removed;
    }

    async zscore(key: string, member: string): Promise<string | null> {
      const score = this.zsets.get(key)?.get(member);
      return score == null ? null : String(score);
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

  let tokenSeq = 0;
  async function makeSession(over: Partial<typeof BASE> = {}): Promise<string> {
    tokenSeq += 1;
    const token = `test-token-${tokenSeq}`;
    await service.createSession(token, { ...BASE, ...over });
    return token;
  }

  beforeEach(() => {
    vi.stubEnv("SESSION_JWT_SECRET", "session-service-test-secret-key-32bytes!!");
    service = new SessionService();
    redis = (service as unknown as { redis: FakeRedis }).redis;
    redis.store.clear();
    redis.zsets.clear();
    redis.ttlMs.clear();
    redis.expiredKeys = [];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("createSession 只落身份：载荷里**没有**上游凭证，令牌由调用方提供", async () => {
    const token = "caller-supplied-token";
    await service.createSession(token, BASE);
    const raw = [...redis.store.values()][0];
    expect(JSON.parse(raw)).not.toHaveProperty("sk");
    expect(redis.store.size).toBe(2);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(true);
  });

  it("resolveSession 解出身份（round-trip）", async () => {
    const token = await makeSession();
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
    const token = await makeSession();
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.sk = "sk-legacy-upstream";
    redis.store.set(key, JSON.stringify(data));

    const session = await service.resolveSession(token);
    expect(session?.userId).toBe(8);
    expect(session).not.toHaveProperty("sk");
  });

  it("resolveSession 对未知令牌返回 null", async () => {
    expect(await service.resolveSession("sess_unknown")).toBeNull();
  });

  it("resolveSession 不再滑动续期（固定 7 天，从签发时刻起算）", async () => {
    const token = await makeSession();
    const key = `session:${hash(token)}`;
    const ttlBefore = await redis.pttl(key);
    await service.resolveSession(token);
    expect(redis.expiredKeys).toHaveLength(0);
    expect(await redis.pttl(key)).toBe(ttlBefore);
  });

  it("resolveSession 对部署前旧会话（无索引键）惰性补建有序索引与旧索引", async () => {
    const token = await makeSession();
    redis.store.delete(`user_session:8:${hash(token)}`);
    redis.zsets.delete("user_sessions:8");

    expect((await service.resolveSession(token))?.userId).toBe(8);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(true);
    expect(redis.zsets.get("user_sessions:8")?.size).toBe(1);
    expect(await service.revokeAllForUser(8)).toBe(1);
  });

  it("verifiedAt 超时后 needsRecheck=true", async () => {
    const token = await makeSession();
    const key = `session:${hash(token)}`;
    const data = JSON.parse(redis.store.get(key)!);
    data.verifiedAt = Date.now() - 6 * 60 * 1000;
    redis.store.set(key, JSON.stringify(data));
    expect((await service.resolveSession(token))?.needsRecheck).toBe(true);
  });

  it("updateSessionIdentity 回写 role/status 并重置 verifiedAt", async () => {
    const token = await makeSession();
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
    const token = await makeSession();
    const key = `session:${hash(token)}`;
    redis.store.set(key, "{ 不是 JSON");
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(key)).toBe(false);
  });

  it("revoke 删除会话与索引（登出吊销）", async () => {
    const token = await makeSession();
    await service.revoke(token);
    expect(await service.resolveSession(token)).toBeNull();
    expect(redis.store.has(`session:${hash(token)}`)).toBe(false);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(false);
  });

  it("revokeAllForUser 删除该用户全部会话并返回计数，不影响其他用户", async () => {
    const a = await makeSession();
    const b = await makeSession();
    const other = await makeSession({ userId: 99, username: "bob" });

    const revoked = await service.revokeAllForUser(8);
    expect(revoked).toBe(2);
    expect(await service.resolveSession(a)).toBeNull();
    expect(await service.resolveSession(b)).toBeNull();
    expect(await service.resolveSession(other)).not.toBeNull();
    expect(redis.store.has(`user_session:8:${hash(a)}`)).toBe(false);
    expect(redis.store.has(`user_session:8:${hash(b)}`)).toBe(false);
    expect(redis.store.has(`user_session:99:${hash(other)}`)).toBe(true);
  });

  it("revokeAllForUser 传 exceptToken 时留下该会话，其余照删且不计入计数", async () => {
    const keep = await makeSession();
    const other = await makeSession();
    const otherDevice = await makeSession();

    const revoked = await service.revokeAllForUser(8, keep);

    expect(revoked).toBe(2);
    expect(await service.resolveSession(keep)).not.toBeNull();
    expect(redis.store.has(`user_session:8:${hash(keep)}`)).toBe(true);
    expect(await service.resolveSession(other)).toBeNull();
    expect(await service.resolveSession(otherDevice)).toBeNull();
  });

  it("revokeAllForUser 的 exceptToken 不存在于该用户名下时等于不豁免（不误伤）", async () => {
    const mine = await makeSession();
    const theirs = await makeSession({ userId: 99, username: "bob" });

    const revoked = await service.revokeAllForUser(8, theirs);

    expect(revoked).toBe(1);
    expect(await service.resolveSession(mine)).toBeNull();
    expect(await service.resolveSession(theirs)).not.toBeNull();
  });

  it("revokeAllForUser 对零会话用户返回 0", async () => {
    await makeSession();
    expect(await service.revokeAllForUser(12345)).toBe(0);
    expect(await service.resolveSession((await makeSession()))).not.toBeNull();
  });
});

describe("SessionService 会话数量与同浏览器替换（PRD 7.5）", () => {
  let service: SessionService;
  let redis: FakeRedis;

  beforeEach(() => {
    vi.stubEnv("SESSION_JWT_SECRET", "session-service-test-secret-key-32bytes!!");
    service = new SessionService();
    redis = (service as unknown as { redis: FakeRedis }).redis;
    redis.store.clear();
    redis.zsets.clear();
    redis.ttlMs.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function make(token: string, clientId?: string): Promise<string> {
    await service.createSession(token, { ...BASE, ...(clientId ? { clientId } : {}) });
    return token;
  }

  it("最多 4 个会话：第 5 个登录淘汰最早登录的", async () => {
    const first = await make("t1");
    await make("t2");
    await make("t3");
    await make("t4");
    await make("t5");

    expect(await service.resolveSession(first)).toBeNull();
    expect(await service.resolveSession("t2")).not.toBeNull();
    expect(await service.resolveSession("t4")).not.toBeNull();
    expect(await service.resolveSession("t5")).not.toBeNull();
    expect(redis.store.has(`user_session:8:${hash(first)}`)).toBe(false);
  });

  it("被淘汰的会话留下标记，前端据此区分「被挤出」和「已过期」", async () => {
    const first = await make("t1");
    await make("t2");
    await make("t3");
    await make("t4");
    await make("t5");

    expect(await service.wasEvicted(first)).toBe(true);
    expect(await service.wasEvicted("t2")).toBe(false);
  });

  it("同一 client_id 重新登录替换旧会话，只占 1 个名额", async () => {
    const old = await make("t-old", "browser-a");
    const keep = await make("t-keep");
    const fresh = await make("t-new", "browser-a");

    expect(await service.resolveSession(old)).toBeNull();
    expect(await service.wasEvicted(old)).toBe(true);
    expect(await service.resolveSession(keep)).not.toBeNull();
    expect(await service.resolveSession(fresh)).not.toBeNull();
  });

  it("不同 client_id 各自计数，挤人时先挤最早的", async () => {
    const a = await make("a", "browser-a");
    const b = await make("b", "browser-b");
    await make("c", "browser-c");
    await make("d", "browser-d");
    await make("e", "browser-e");

    expect(await service.resolveSession(a)).toBeNull();
    expect(await service.resolveSession(b)).not.toBeNull();
  });

  it("部署前会话（只有旧索引键、不在有序索引里）在被访问时补进有序索引，并按最早处理", async () => {
    const legacy = await make("legacy");
    redis.zsets.delete("user_sessions:8");
    await service.resolveSession(legacy);
    const keep = await make("n1");
    await make("n2");
    await make("n3");
    await make("n4");

    expect(await service.resolveSession(legacy)).toBeNull();
    expect(await service.wasEvicted(legacy)).toBe(true);
    expect(await service.resolveSession(keep)).not.toBeNull();
  });
});

describe("normalizeClientId（同浏览器标识契约）", () => {
  it("8–64 字符的原样保留（去首尾空白）", () => {
    expect(normalizeClientId("  abcdefgh  ")).toBe("abcdefgh");
    expect(normalizeClientId("x".repeat(64))).toBe("x".repeat(64));
  });

  it("过短、过长、非字符串、空白 → undefined", () => {
    expect(normalizeClientId("short")).toBeUndefined();
    expect(normalizeClientId("x".repeat(65))).toBeUndefined();
    expect(normalizeClientId("        ")).toBeUndefined();
    expect(normalizeClientId(123)).toBeUndefined();
    expect(normalizeClientId(undefined)).toBeUndefined();
  });
});
