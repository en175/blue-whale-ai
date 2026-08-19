import { createNewApiClient } from "@blue-whale/core";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

/** 折扣表 option 键（Go 点分子键）。 */
const DISCOUNT_OPTION_KEY = "payment_setting.amount_discount";

type GoDiscountMap = Record<string, number>;

export interface GoDiscountSyncConfig {
  baseUrl: string;
  rootToken: string;
  rootUserId: number;
}

type Env = Record<string, string | undefined>;

/** 从 env 读 root 凭证；缺任一非法 → null（调用方降级 no-op）。 */
export function loadGoDiscountSyncConfig(
  env: Env = process.env,
): GoDiscountSyncConfig | null {
  const baseUrl = env.NEW_API_BASE_URL;
  const rootToken = env.NEW_API_ROOT_ACCESS_TOKEN;
  const rootUserId = Number(env.NEW_API_ROOT_USER_ID ?? "");
  if (
    !baseUrl ||
    !rootToken ||
    !Number.isInteger(rootUserId) ||
    rootUserId <= 0
  ) {
    return null;
  }
  return { baseUrl, rootToken, rootUserId };
}

function discountKey(originalPrice: number): string {
  return String(Math.round(originalPrice));
}

/** 进程内串行队列：折扣表 RMW 非原子，串行化避免并发覆盖。 */
let syncQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = syncQueue.then(work);
  syncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readDiscountMap(cfg: GoDiscountSyncConfig): Promise<GoDiscountMap> {
  const client = createNewApiClient({ baseUrl: cfg.baseUrl });
  const raw = await client.getRootOption(
    cfg.rootToken,
    cfg.rootUserId,
    DISCOUNT_OPTION_KEY,
  );
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as GoDiscountMap)
      : {};
  } catch {
    return {};
  }
}

async function writeDiscountMap(
  cfg: GoDiscountSyncConfig,
  map: GoDiscountMap,
): Promise<void> {
  const client = createNewApiClient({ baseUrl: cfg.baseUrl });
  await client.putRootOption(
    cfg.rootToken,
    cfg.rootUserId,
    DISCOUNT_OPTION_KEY,
    JSON.stringify(map),
  );
}

export async function syncTierDiscountToGo(
  originalPrice: number,
  discount: number,
  env: Env = process.env,
): Promise<boolean> {
  const cfg = loadGoDiscountSyncConfig(env);
  if (!cfg) {
    logger.warn(
      "[go-amount-discount] 未配置 root 凭证，跳过折扣同步",
    );
    return false;
  }
  return serialized(async () => {
    const map = await readDiscountMap(cfg);
    map[discountKey(originalPrice)] = discount;
    await writeDiscountMap(cfg, map);
    return true;
  });
}

export async function removeTierDiscountFromGo(
  originalPrice: number,
  env: Env = process.env,
): Promise<boolean> {
  const cfg = loadGoDiscountSyncConfig(env);
  if (!cfg) {
    logger.warn(
      "[go-amount-discount] 未配置 root 凭证，跳过折扣同步",
    );
    return false;
  }
  return serialized(async () => {
    const map = await readDiscountMap(cfg);
    delete map[discountKey(originalPrice)];
    await writeDiscountMap(cfg, map);
    return true;
  });
}

export async function syncAllTierDiscountsToGo(
  tiers: Array<{ originalPrice: number; discount: number }>,
  env: Env = process.env,
): Promise<number> {
  if (tiers.length === 0) return 0;
  const cfg = loadGoDiscountSyncConfig(env);
  if (!cfg) return 0;
  return serialized(async () => {
    const map = await readDiscountMap(cfg);
    for (const { originalPrice, discount } of tiers) {
      if (discount > 0 && discount <= 1) {
        map[discountKey(originalPrice)] = discount;
      }
    }
    await writeDiscountMap(cfg, map);
    return tiers.length;
  });
}
