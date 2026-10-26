import { Redis } from "ioredis";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import type { ModelCapabilityView } from "./model-capability-repo.js";

export const MODEL_CAPABILITY_CACHE_TTL_SECONDS = 300;

const CACHE_PREFIX = "cap:list:";
const INVALIDATE_MATCH = "cap:*";

let client: Redis | null = null;
let clientDisabled = false;
let breakerUntil = 0;

const WARN_THROTTLE_MS = 30_000;
const warnedAt = new Map<string, number>();

function cacheConfigured(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.REDIS_HOST || process.env.REDIS_CONN_STRING);
}

function getClient(): Redis | null {
  if (clientDisabled || !cacheConfigured()) return null;
  if (client) return client;
  try {
    client = new Redis(redisConnectionOptions());
    client.on("error", (err: unknown) => warnThrottled("连接异常", String(err)));
  } catch (err) {
    clientDisabled = true;
    warnThrottled("初始化失败，本进程旁路缓存", String(err));
    return null;
  }
  return client;
}

function warnThrottled(channel: string, detail: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(channel) ?? 0) < WARN_THROTTLE_MS) return;
  warnedAt.set(channel, now);
  // eslint-disable-next-line no-console
  console.warn(`[model-capability-cache] ${channel}: ${detail}`);
}

const READY_TIMEOUT_MS = 1_000;
const BREAKER_OPEN_MS = 30_000;

async function readyClient(): Promise<Redis | null> {
  const redis = getClient();
  if (!redis) return null;
  if (redis.status === "ready") return redis;
  if (Date.now() < breakerUntil) return null;
  if (await waitForReady(redis, READY_TIMEOUT_MS)) return redis;
  breakerUntil = Date.now() + BREAKER_OPEN_MS;
  return null;
}

function waitForReady(redis: Redis, timeoutMs: number): Promise<boolean> {
  if (redis.status === "ready") return Promise.resolve(true);
  return new Promise((resolve) => {
    const settle = (ok: boolean) => {
      clearTimeout(timer);
      redis.off("ready", onReady);
      redis.off("error", onError);
      redis.off("end", onEnd);
      resolve(ok);
    };
    const onReady = () => settle(true);
    const onError = () => settle(false);
    const onEnd = () => settle(false);
    const timer = setTimeout(() => settle(false), timeoutMs);
    redis.once("ready", onReady);
    redis.once("error", onError);
    redis.once("end", onEnd);
  });
}

function key(type: string): string {
  return `${CACHE_PREFIX}${type}`;
}

export async function getModelCapabilityList(
  type: string,
): Promise<ModelCapabilityView[] | null> {
  const redis = await readyClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(key(type));
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ModelCapabilityView[]) : null;
  } catch (err) {
    warnThrottled("读失败，按未命中处理", String(err));
    return null;
  }
}

export async function setModelCapabilityList(
  type: string,
  views: ModelCapabilityView[],
): Promise<void> {
  const redis = await readyClient();
  if (!redis) return;
  try {
    await redis.set(
      key(type),
      JSON.stringify(views),
      "EX",
      MODEL_CAPABILITY_CACHE_TTL_SECONDS,
    );
  } catch (err) {
    warnThrottled("写失败，本次不回填", String(err));
  }
}

export async function invalidateModelCapabilityCache(): Promise<void> {
  const redis = await readyClient();
  if (!redis) return;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        INVALIDATE_MATCH,
        "COUNT",
        200,
      );
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch (err) {
    warnThrottled("失效失败，等 TTL 收敛", String(err));
  }
}

export async function __resetModelCapabilityCacheForTest(): Promise<void> {
  const current = client;
  client = null;
  clientDisabled = false;
  breakerUntil = 0;
  warnedAt.clear();
  if (current) {
    try {
      await current.quit();
    } catch {
      current.disconnect();
    }
  }
}
