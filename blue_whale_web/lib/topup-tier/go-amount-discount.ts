import { createWebNewApiClient } from "@/lib/logging";

/**
 * web 档位折扣 → Go `payment_setting.amount_discount` 同步。
 *
 * 架构（Model B + A+）：充值目录在 web（topup_tiers），结算复用 Go 原生 new-api 充值。
 * Go 原生实付公式 Money = N × Price × TopupGroupRatio[group] × AmountDiscount[N]；
 * blue_whale 分组两个倍率置 1 后，逐档折扣唯一来源就是 AmountDiscount。
 * 故 web 在档位 CRUD 时维护 AmountDiscount[round(originalPrice)] = discount（直填，无 1-x）。
 *
 * 存储形态（实测）：Go 用 config.GlobalConfig.Register 把 PaymentSetting 结构体**拆成点分子键**
 * 存进 option 表——`payment_setting.amount_discount` / `payment_setting.amount_options` /
 * `payment_setting.compliance_*` 各是独立 option。折扣表就是 `payment_setting.amount_discount`
 * 这一个键，value 是 map[int]float64 的 JSON（键为字符串化整数 N，如 {"100":0.85}）。
 * 因此只需整表读写该键，无需触碰其它子键。
 *
 * 注意：`payment_setting.compliance_*` 被 Go UpdateOption 禁止经通用接口修改（前缀校验），
 * 但 amount_discount / amount_options 不在其列，可正常 PUT。
 *
 * amount_discount 是按金额 N 的全局表（非按分组/入口）——会泄漏到 Go 后台自身充值面，
 * 隔离须 Go 代码，见后续工单 IK5W97。本模块只做「按 web 档位增删 key」的尽力同步。
 *
 * 鉴权：写 Go option 走 PUT /api/option/（middleware.RootAuth），需 root 的 access_token
 * + New-Api-User 头（= 令牌属主数字 id）。凭证经 env 注入（NEW_API_ROOT_ACCESS_TOKEN /
 * NEW_API_ROOT_USER_ID），未配置则降级为 no-op（不阻断档位 CRUD）。
 */

/** 折扣表的 option 键（Go 点分子键，非整块 payment_setting）。 */
const DISCOUNT_OPTION_KEY = "payment_setting.amount_discount";

/** AmountDiscount 的 JSON 形态：map[int]float64 → 键是字符串化整数 N。 */
type GoDiscountMap = Record<string, number>;

export interface GoDiscountSyncConfig {
  baseUrl: string;
  rootToken: string;
  rootUserId: number;
}

type Env = Record<string, string | undefined>;

/** 从 env 读 root 凭证；缺任一非法 → null（调用方按「未配置」降级 no-op）。 */
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

/** 折扣表的 key：整数 N 的字符串形（对齐 Go map[int]float64 的 JSON 键）。 */
function discountKey(originalPrice: number): string {
  return String(Math.round(originalPrice));
}

/**
 * 进程内串行队列：折扣表同步是「读整表 → 改 → 写整表」的非原子 RMW，
 * 两个并发同步会各自读到旧表再互相覆盖、丢 key（管理端快速连建两个档位即可触发）。
 * 串行化保证本进程内 RMW 不交错。局限：仅单进程有效，多实例部署仍可能竞争——
 * 本同步定位是尽力最终一致，竞争窗口交给后续对账手段（见模块头注）。
 */
let syncQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = syncQueue.then(work);
  // 队列自身不因单次失败断裂；调用方仍通过 result 拿到原始错误。
  syncQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 读折扣表；键不存在 / 解析失败 / 非对象 → 空表（可重建）。 */
async function readDiscountMap(
  cfg: GoDiscountSyncConfig,
): Promise<GoDiscountMap> {
  const client = createWebNewApiClient({ baseUrl: cfg.baseUrl });
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

/** 整表写回：value 为 JSON 字符串（Go UpdateOption 对 object 值会 fmt 损坏）。 */
async function writeDiscountMap(
  cfg: GoDiscountSyncConfig,
  map: GoDiscountMap,
): Promise<void> {
  const client = createWebNewApiClient({ baseUrl: cfg.baseUrl });
  await client.putRootOption(
    cfg.rootToken,
    cfg.rootUserId,
    DISCOUNT_OPTION_KEY,
    JSON.stringify(map),
  );
}

/**
 * 档位创建/更新后调用：AmountDiscount[round(originalPrice)] = discount。
 * 未配置凭证 → warn + 返回 false（不抛）；已配置但 Go 出错 → 抛出（由路由 catch 记录，
 * 不阻断档位 CRUD）。成功返回 true。
 */
export async function syncTierDiscountToGo(
  originalPrice: number,
  discount: number,
  env: Env = process.env,
): Promise<boolean> {
  const cfg = loadGoDiscountSyncConfig(env);
  if (!cfg) {
    console.warn(
      "[go-amount-discount] 未配置 NEW_API_ROOT_ACCESS_TOKEN / NEW_API_ROOT_USER_ID，跳过折扣同步",
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

/**
 * 档位删除（或原价变更前的旧档）后调用：移除该 N 的折扣 key。
 * 语义同 syncTierDiscountToGo（未配置 no-op，Go 出错抛出）。
 */
export async function removeTierDiscountFromGo(
  originalPrice: number,
  env: Env = process.env,
): Promise<boolean> {
  const cfg = loadGoDiscountSyncConfig(env);
  if (!cfg) {
    console.warn(
      "[go-amount-discount] 未配置 NEW_API_ROOT_ACCESS_TOKEN / NEW_API_ROOT_USER_ID，跳过折扣同步",
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
