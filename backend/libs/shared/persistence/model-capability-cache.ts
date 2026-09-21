import { Redis } from "ioredis";
import { redisConnectionOptions } from "@lib/shared/rate-limit/redis-connection.js";
import type { ModelCapabilityView } from "./model-capability-repo.js";

/** 消费端模型能力目录的 Redis 缓存（IKH BDO）。
 *
 *  为什么值得缓存：`listEnabledByType` 是生成链路每次创建任务都要走的白名单查询，
 *  而配置变更极低频——把这条热路径从「每次查库」降成「每 5 分钟查一次库」。
 *
 *  失效策略：写路径显式删（见 model-capability-admin-repo 的各个写方法），TTL 只兜底。
 *  迁移脚本与直改库绕过应用、钩子不会触发，靠 TTL 收敛 + 手动清空入口补上。
 *  一律**按前缀整片删**，不做「改了哪行就删哪个 key」的推导——推导漏一个就是脏读到 TTL。
 *
 *  ⚠️ 硬约束：**写侧校验不得读缓存**。校验读到 5 分钟前的旧值等于没校验，
 *  会重新打开「映射表被静默清空」那个洞。缓存只服务读路径。
 *
 *  降级：未配 Redis（本地/单测）直接旁路；连不上或读写报错一律当未命中，
 *  打一次日志、不抛——缓存挂了不该把生成链路一起带走。
 */
export const MODEL_CAPABILITY_CACHE_TTL_SECONDS = 300;

const CACHE_PREFIX = "cap:list:";
const INVALIDATE_MATCH = "cap:*";

let client: Redis | null = null;
let clientDisabled = false;
/** 连不上时的熔断窗口截止时间（见 readyClient）。 */
let breakerUntil = 0;

const WARN_THROTTLE_MS = 30_000;
const warnedAt = new Map<string, number>();

function cacheConfigured(): boolean {
  // 单测环境一律旁路：门控集成测试是「直接 upsert 能力行 → 走接口读」，
  // 缓存不失效会让它们读到 5 分钟前的旧值，报出与被测代码无关的失败。
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(process.env.REDIS_HOST || process.env.REDIS_CONN_STRING);
}

/** 惰性建连：未配 Redis 的进程（单测、本地裸跑）完全不碰网络。 */
function getClient(): Redis | null {
  if (clientDisabled || !cacheConfigured()) return null;
  if (client) return client;
  try {
    client = new Redis(redisConnectionOptions());
    client.on("error", (err: unknown) => warnThrottled("连接异常", String(err)));
  } catch (err) {
    // redisConnectionOptions 在生产缺配置时会抛；到这里说明没配好，旁路即可。
    clientDisabled = true;
    warnThrottled("初始化失败，本进程旁路缓存", String(err));
    return null;
  }
  return client;
}

/** 按**类别**节流，而不是「一辈子只打一次」：连接抖动会把唯一的那次额度吃掉，
 *  真正要命的失效失败（改完配置最长 5 分钟不生效）反而一声不吭。
 *  仓库里 `libs/core/tls-writer.ts` 是同一路数。 */
function warnThrottled(channel: string, detail: string): void {
  const now = Date.now();
  if (now - (warnedAt.get(channel) ?? 0) < WARN_THROTTLE_MS) return;
  warnedAt.set(channel, now);
  // eslint-disable-next-line no-console
  console.warn(`[model-capability-cache] ${channel}: ${detail}`);
}

const READY_TIMEOUT_MS = 1_000;
/** 等不到 ready 之后的熔断窗口：断了以后每次生成请求都陪着等一次重连退避，
 *  实测单次 4ms→450ms 逐次爬升。窗口内直接回源，不陪等。 */
const BREAKER_OPEN_MS = 30_000;

/** 拿一个**已就绪**的连接；等不到就当未命中。
 *
 *  惰性建连 + `enableOfflineQueue: false` 的组合下，首次调用必然撞上握手期——
 *  ioredis 会直接抛 `Stream isn't writeable`，于是「刚重启的头几秒缓存全不生效」
 *  （每次断线重连都会重现一次）。这里显式等 ready，超时即旁路：宁可查库，
 *  也不要让生成链路卡在等 Redis 上。 */
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

/** 读缓存；未命中、未配、任何异常 → null（调用方回源查库）。 */
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

/** 回填缓存；失败静默——缓存是加速手段，写不进去不影响本次返回值。 */
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

/** 整片失效（前缀扫删）。所有会改能力行的写路径成功后调用。 */
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
    // 这条最要命：失效失败 = 改完配置最长 5 分钟不生效，必须留痕。
    warnThrottled("失效失败，等 TTL 收敛", String(err));
  }
}

/** 仅供测试：断开并复位模块级状态。 */
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
