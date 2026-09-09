import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitAllowlist, parseRateLimitAllowlist } from "./rate-limit-allowlist.js";

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

function allowlist(overrides: Record<string, string>): RateLimitAllowlist {
  vi.stubEnv("RATE_LIMIT_ALLOW_IPS", overrides.RATE_LIMIT_ALLOW_IPS ?? "");
  vi.stubEnv("RATE_LIMIT_ALLOW_ACCOUNTS", overrides.RATE_LIMIT_ALLOW_ACCOUNTS ?? "");
  return new RateLimitAllowlist();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseRateLimitAllowlist", () => {
  it("treats missing env vars as empty allowlists", () => {
    const entries = parseRateLimitAllowlist(env({}));
    expect(entries.ipv4).toEqual([]);
    expect(entries.ipv6.size).toBe(0);
    expect(entries.accounts.size).toBe(0);
  });

  it("parses exact IPv4, IPv4 CIDR and IPv6 entries", () => {
    const entries = parseRateLimitAllowlist(
      env({ RATE_LIMIT_ALLOW_IPS: "203.0.113.7, 10.0.0.0/8,192.168.1.0/24, ::1 , 2001:DB8::ff" }),
    );
    expect(entries.ipv4).toHaveLength(3);
    // 精确 IPv4 以 /32 range 存储，钉住实现契约
    expect(entries.ipv4[0]).toEqual({ network: 0xcb007107, mask: 0xffffffff });
    expect(entries.ipv6.has("::1")).toBe(true);
    expect(entries.ipv6.has("2001:db8::ff")).toBe(true);
  });

  it("normalizes CIDR entries to their network address", () => {
    // 10.1.2.3/8 与 10.0.0.0/8 是同一个段
    const entries = parseRateLimitAllowlist(env({ RATE_LIMIT_ALLOW_IPS: "10.1.2.3/8" }));
    expect(entries.ipv4[0]).toEqual({ network: 0x0a000000, mask: 0xff000000 });
  });

  it("rejects /0 CIDR (would allow everything)", () => {
    expect(() => parseRateLimitAllowlist(env({ RATE_LIMIT_ALLOW_IPS: "0.0.0.0/0" }))).toThrow(/\/0/);
  });

  it("rejects prefix longer than 32 and malformed entries at parse time", () => {
    for (const bad of [
      "10.0.0.0/33",
      "10.0.0.0/",
      "256.1.1.1",
      "1.2.3",
      "not-an-ip",
      "10.0.0.0/8/8",
      // 前导零是 parser-differential（八进制歧义），必须拒绝而非静默解析
      "010.1.1.1",
      "1.2.3.04",
      "10.0.0.0/08",
    ]) {
      expect(() => parseRateLimitAllowlist(env({ RATE_LIMIT_ALLOW_IPS: bad }))).toThrow(
        /RATE_LIMIT_ALLOW_IPS/,
      );
    }
  });

  it("rejects malformed IPv6 entries instead of silently accepting them", () => {
    for (const bad of [":::", "a:b", "12345::", "2001:db8::ff%eth0"]) {
      expect(() => parseRateLimitAllowlist(env({ RATE_LIMIT_ALLOW_IPS: bad }))).toThrow(
        /RATE_LIMIT_ALLOW_IPS/,
      );
    }
  });

  it("keeps account entries trimmed, non-empty and case-sensitive", () => {
    const entries = parseRateLimitAllowlist(
      env({ RATE_LIMIT_ALLOW_ACCOUNTS: " alice ,bob,, alice bob " }),
    );
    // 只 trim 两端；内部空格是合法 username 字符，原样保留
    expect([...entries.accounts].sort()).toEqual(["alice", "alice bob", "bob"]);
  });
});

describe("RateLimitAllowlist.isAllowed", () => {
  it("matches exact IPv4 and CIDR membership, rejects outside ranges", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_IPS: "203.0.113.7,10.0.0.0/8,192.168.1.0/24" });
    expect(list.isAllowed("ip", "203.0.113.7")).toBe(true);
    expect(list.isAllowed("ip", "203.0.113.8")).toBe(false);
    expect(list.isAllowed("ip", "10.255.0.1")).toBe(true);
    expect(list.isAllowed("ip", "11.0.0.1")).toBe(false);
    expect(list.isAllowed("ip", "192.168.1.255")).toBe(true);
    expect(list.isAllowed("ip", "192.168.2.0")).toBe(false);
  });

  it("matches /32 as a single IP only", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_IPS: "172.16.0.9/32" });
    expect(list.isAllowed("ip", "172.16.0.9")).toBe(true);
    expect(list.isAllowed("ip", "172.16.0.10")).toBe(false);
  });

  it("matches IPv6 exactly and case-insensitively, without range support", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_IPS: "2001:db8::ff" });
    expect(list.isAllowed("ip", "2001:DB8::FF")).toBe(true);
    expect(list.isAllowed("ip", "2001:db8::fe")).toBe(false);
  });

  it("unwraps IPv4-mapped IPv6 keys from dual-stack proxies", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_IPS: "203.0.113.0/24" });
    expect(list.isAllowed("ip", "::ffff:203.0.113.9")).toBe(true);
    expect(list.isAllowed("ip", "::ffff:203.0.114.9")).toBe(false);
  });

  it("ignores malformed request keys instead of throwing", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_IPS: "10.0.0.0/8" });
    expect(list.isAllowed("ip", "garbage")).toBe(false);
    expect(list.isAllowed("ip", "")).toBe(false);
    // 请求侧同样拒绝前导零形态，防上游代理解析差异导致误命中
    expect(list.isAllowed("ip", "010.0.0.1")).toBe(false);
  });

  it("matches accounts trimmed, exact and case-sensitive", () => {
    const list = allowlist({ RATE_LIMIT_ALLOW_ACCOUNTS: "alice, bob" });
    expect(list.isAllowed("account", "alice")).toBe(true);
    expect(list.isAllowed("account", "bob")).toBe(true);
    expect(list.isAllowed("account", "Alice")).toBe(false);
    expect(list.isAllowed("account", "alice ")).toBe(false);
    expect(list.isAllowed("account", "carol")).toBe(false);
  });

  it("never exempts the user dimension", () => {
    const list = allowlist({
      RATE_LIMIT_ALLOW_IPS: "10.0.0.0/8",
      RATE_LIMIT_ALLOW_ACCOUNTS: "alice",
    });
    expect(list.isAllowed("user", "10.0.0.1")).toBe(false);
    expect(list.isAllowed("user", "alice")).toBe(false);
    expect(list.isAllowed("user", "12345")).toBe(false);
  });
});
