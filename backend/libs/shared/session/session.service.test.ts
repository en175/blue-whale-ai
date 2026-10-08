import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionService } from "./session.service.js";

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

  it("resolveSession 每次访问滑动续期（调用 EXPIRE）", async () => {
    const token = await makeSession();
    await service.resolveSession(token);
    expect(redis.expiredKeys).toContain(`session:${hash(token)}`);
    expect(redis.setKeys).toContain(`user_session:8:${hash(token)}`);
  });

  it("resolveSession 对部署前旧会话（无索引键）惰性补建索引", async () => {
    const token = await makeSession();
    redis.store.delete(`user_session:8:${hash(token)}`);

    expect((await service.resolveSession(token))?.userId).toBe(8);
    expect(redis.store.has(`user_session:8:${hash(token)}`)).toBe(true);
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
