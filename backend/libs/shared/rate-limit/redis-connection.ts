import type { RedisOptions } from "ioredis";

/** Redis 连接：显式 REDIS_HOST/PORT/DB/PASSWORD 优先，缺失回退解析 REDIS_CONN_STRING（与 video-queue 同源）。
 *  生产环境两者皆缺 → 启动即抛（fail-fast，避免静默连本地 Redis 污染会话）。 */
export function redisConnectionOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RedisOptions {
  let { REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD } = env;
  if (!REDIS_HOST && env.REDIS_CONN_STRING) {
    try {
      const u = new URL(env.REDIS_CONN_STRING);
      REDIS_HOST = u.hostname;
      REDIS_PORT = u.port;
      REDIS_DB = u.pathname.replace(/^\//, "");
      if (u.password) REDIS_PASSWORD = decodeURIComponent(u.password);
    } catch {
      // 解析失败走默认 127.0.0.1
    }
  }
  if (env.NODE_ENV === "production" && !REDIS_HOST) {
    throw new Error("REDIS_HOST / REDIS_CONN_STRING 必填（生产环境会话依赖 Redis）");
  }
  return {
    host: REDIS_HOST ?? "127.0.0.1",
    port: Number.parseInt(REDIS_PORT ?? "6379", 10),
    db: Number.parseInt(REDIS_DB ?? "0", 10),
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
    keepAlive: 30_000,
  };
}
