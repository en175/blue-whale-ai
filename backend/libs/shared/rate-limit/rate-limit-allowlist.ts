import { Injectable } from "@nestjs/common";
import { isIPv6 } from "node:net";
import type { RateLimitKey } from "./decorators/rate-limit.decorator.js";

const ALLOW_IPS_ENV = "RATE_LIMIT_ALLOW_IPS";
const ALLOW_ACCOUNTS_ENV = "RATE_LIMIT_ALLOW_ACCOUNTS";

/** IPv4 CIDR 段：32 位网络地址 + 掩码；/32 即精确单 IP。 */
type Ipv4Range = { network: number; mask: number };

export type RateLimitAllowlistEntries = {
  ipv4: Ipv4Range[];
  /** IPv6 只做小写精确匹配，不支持段。 */
  ipv6: Set<string>;
  /** trim 后精确、大小写敏感，与 extractKey("account") 同尺子。 */
  accounts: Set<string>;
};

function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // 拒绝前导零（"010" 等）：八进制/十进制歧义是经典 parser-differential，
    // 对授予限流豁免特权的解析器必须 fail-closed（参考 netmask CVE-2021-28918）。
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function splitEntries(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * 解析白名单环境变量；任一条目非法立即抛错（fail-closed，启动即失败）。
 * `/0` 等于全放行，显式拒绝。
 */
export function parseRateLimitAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitAllowlistEntries {
  const ipv4: Ipv4Range[] = [];
  const ipv6 = new Set<string>();
  for (const entry of splitEntries(env[ALLOW_IPS_ENV])) {
    const slash = entry.indexOf("/");
    if (slash >= 0) {
      const ipPart = entry.slice(0, slash);
      const prefixText = entry.slice(slash + 1);
      const ip = parseIpv4(ipPart);
      // 前缀同样拒绝前导零（"08"）；0 与 >32 由下方范围检查给出专用报错
      if (ip === null || !/^(0|[1-9]\d?)$/.test(prefixText)) {
        throw new Error(`${ALLOW_IPS_ENV} 含非法 IPv4 CIDR 条目: ${entry}`);
      }
      const prefix = Number(prefixText);
      if (prefix < 1 || prefix > 32) {
        throw new Error(
          `${ALLOW_IPS_ENV} 条目 ${entry} 前缀长度必须在 1-32 之间（/0 等于全放行，禁止）`,
        );
      }
      const mask = prefix === 32 ? 0xffffffff : ((0xffffffff << (32 - prefix)) >>> 0);
      ipv4.push({ network: (ip & mask) >>> 0, mask });
      continue;
    }
    const ip = parseIpv4(entry);
    if (ip !== null) {
      ipv4.push({ network: ip, mask: 0xffffffff });
      continue;
    }
    // net.isIPv6 在 Node >= 20 接受 zone-id（%eth0），但带 zone-id 的条目
    // 永远匹配不上请求 key，按非法拒绝而不是静默收进名单
    if (isIPv6(entry) && !entry.includes("%")) {
      ipv6.add(entry.toLowerCase());
      continue;
    }
    throw new Error(`${ALLOW_IPS_ENV} 含非法 IP 条目: ${entry}`);
  }

  const accounts = new Set(splitEntries(env[ALLOW_ACCOUNTS_ENV]));
  return { ipv4, ipv6, accounts };
}

/** ::ffff:1.2.3.4 形态剥出内嵌 IPv4，供双栈代理后的 XFF 命中 IPv4 名单。 */
function unwrapIpv4Mapped(key: string): string | null {
  const lower = key.toLowerCase();
  if (!lower.startsWith("::ffff:")) return null;
  const embedded = lower.slice("::ffff:".length);
  return parseIpv4(embedded) !== null ? embedded : null;
}

function matchIp(entries: RateLimitAllowlistEntries, key: string): boolean {
  const candidates = [key];
  const mapped = unwrapIpv4Mapped(key);
  if (mapped) candidates.push(mapped);
  for (const candidate of candidates) {
    if (candidate.includes(":")) {
      if (entries.ipv6.has(candidate.toLowerCase())) return true;
      continue;
    }
    const ip = parseIpv4(candidate);
    if (ip === null) continue;
    for (const range of entries.ipv4) {
      if ((ip & range.mask) >>> 0 === range.network) return true;
    }
  }
  return false;
}

/**
 * 限流豁免名单（RateLimitAllowlist）：本类只提供 ip / account 两个匹配原语，
 * 豁免粒度是**请求级**——guard 用 `X-Real-IP`（真实连接 IP）与 body.username 各查一次，
 * 任一命中即整个请求跳过全部 @RateLimit 频率桶（含 user 维度桶，不消耗 Redis 计数）。
 * 登录失败锁定不被豁免，但机制不是"在 take 内部"——guard 短路发生在 take 之前，
 * take 内的 rlblock 检查同样会被跳过；真实原因是 login_lock scope 的封锁检查由
 * AuthController 在 guard 之外独立执行。若未来对某个桶 scope 直接调 limiter.block()，
 * 豁免短路会连带跳过该封锁检查，届时需要把封锁检查挪到 guard 短路之前。
 * 名单来自环境变量，启动加载一次；改名单需重启（IKEBOY 设计决策）。
 */
@Injectable()
export class RateLimitAllowlist {
  private readonly entries: RateLimitAllowlistEntries;

  constructor() {
    this.entries = parseRateLimitAllowlist();
  }

  isAllowed(kind: RateLimitKey, key: string): boolean {
    if (kind === "ip") return matchIp(this.entries, key);
    if (kind === "account") return this.entries.accounts.has(key);
    return false;
  }
}
