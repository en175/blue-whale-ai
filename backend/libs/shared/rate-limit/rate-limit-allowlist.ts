import { Injectable } from "@nestjs/common";
import { isIPv6 } from "node:net";
import type { RateLimitKey } from "./decorators/rate-limit.decorator.js";

const ALLOW_IPS_ENV = "RATE_LIMIT_ALLOW_IPS";
const ALLOW_ACCOUNTS_ENV = "RATE_LIMIT_ALLOW_ACCOUNTS";

type Ipv4Range = { network: number; mask: number };

export type RateLimitAllowlistEntries = {
  ipv4: Ipv4Range[];
  ipv6: Set<string>;
  accounts: Set<string>;
};

function parseIpv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
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
    if (isIPv6(entry) && !entry.includes("%")) {
      ipv6.add(entry.toLowerCase());
      continue;
    }
    throw new Error(`${ALLOW_IPS_ENV} 含非法 IP 条目: ${entry}`);
  }

  const accounts = new Set(splitEntries(env[ALLOW_ACCOUNTS_ENV]));
  return { ipv4, ipv6, accounts };
}

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
