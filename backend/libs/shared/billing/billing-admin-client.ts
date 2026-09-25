/* ============================================
 * billing 的**管理端 HTTP 面**客户端（发放积分 / 读定价目录）
 *
 * 与 `billing-client.ts` 的区别：那个走 gRPC，是**用户等待路径**（预扣、报价、查余额）；
 * 这个走 billing 的 HTTP 管理端口，做的是**改账本**（发放）与**读配置**（换算率）。
 * 两条面协议不同、端口不同、权限也不同（HTTP 管理面**没有鉴权**，只在内部网络），
 * 所以是两个客户端而不是一个。
 *
 * ⚠️ **发放幂等靠 billing，不靠我们**：同一个 `grantKey`（= `purchased:{bizId}`）重复发放
 *    会被唯一索引拦下并返回 409。这条比「我们自己记得发过没有」强——进程重启、回调重投、
 *    两个请求并发进来，唯一索引都拦得住。调用方要把 409 当成**成功**（这笔之前已经发过了）。
 *
 * ⚠️ `BILLING_ADMIN_URL` 未配置即抛：发放配不出地址时若静默跳过，用户付了钱而账没进，
 *    且没有任何报错——那是直接的资金事故。
 * ============================================ */
import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";

export const BILLING_ADMIN_URL_ENV = "BILLING_ADMIN_URL";

/**
 * 配置问题（地址没配、目录没有生效版本）。
 *
 * <p>与 {@link BillingAdminError} 分开：**重试解决不了配错**，而这两类错误的处置完全不同——
 * 前者要人改配置并重启，后者可能要等 billing 恢复。混成一个类型就只能靠读文案判。
 */
export class BillingAdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingAdminConfigError";
  }
}

/** 调用失败（网络、超时、HTTP 非 2xx）。 */
export class BillingAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingAdminError";
  }
}

/** billing 管理端地址（去掉尾部斜杠）。未配置即抛。 */
export function billingAdminUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[BILLING_ADMIN_URL_ENV] ?? "").trim();
  if (!raw) {
    throw new BillingAdminConfigError(
      `计费管理端地址未配置（缺环境变量 ${BILLING_ADMIN_URL_ENV}）：充值到账必须能发放积分，` +
        `不能在没有计费服务的情况下放行`,
    );
  }
  return raw.replace(/\/+$/, "");
}

/* ---------- 定价目录：换算率 ---------- */

/** `GET /admin/catalogs/active` 的回包。`catalogVersion = -1` 表示**没有生效的目录**。 */
interface ActiveCatalogResponse {
  catalogVersion?: number;
  creditsPerYuan?: number;
}

/**
 * 读当前生效的换算率「1 元 = 多少积分」。
 *
 * <p>它是**定价目录的配置项**（版本化、可整体回滚），不是代码常量——
 * 唯一的硬约束是「只能从目录读」（见 `docs/specs/billing-units-contract.md`）。
 *
 * <p>⚠️ 没有生效目录时 billing 返回 `-1`，这里**直接抛**：换算率取不到就不该给用户报价。
 *    回退成某个默认值会让「用户看到的积分」变成编的，而它恰恰是用来核对积分对不对的那个数。
 */
export async function fetchCreditsPerYuan(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const data = await request<ActiveCatalogResponse>("/admin/catalogs/active", {
    method: "GET",
    env,
  });
  const rate = data.creditsPerYuan ?? -1;
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new BillingAdminConfigError(
      `定价目录没有生效版本（creditsPerYuan=${rate}）：先发布一版目录再开充值`,
    );
  }
  return rate;
}

/* ---------- 账本：发放 ---------- */

export interface GrantCreditsInput {
  userId: number;
  /** 发放的**整数积分**（与用户账本同单位，不是 mc、不是 quota） */
  credits: number;
  /**
   * 幂等键的业务主键 —— 用**我们的交易单号**（`recharge_orders.trade_no`）。
   *
   * <p>它同时是这批积分的「来路凭证」：事后要能回答「这 1000 分为何在这里」。
   * 同一笔交易重复回调时，同一个 bizId 会被 billing 拒成 409。
   */
  bizId: string;
}

export interface GrantCreditsResult {
  /** billing 批次 id（本地订单留一份用于对账）；幂等命中时为空串 */
  lotId: string;
  /** 幂等命中：这笔之前已经发过了（409），本次没有重复发放 */
  duplicated: boolean;
}

/**
 * 发放积分（`POST /admin/credits/grants`，`source = purchased`）。
 *
 * <p>`source = purchased` 决定这批积分的有效期策略（充值本金**永久**），
 * 由 billing 的 `GrantPolicy` 按来源决定，这里不传 `expiresAt`——
 * 传了就是让「充值本金永久」这条产品约定变成每个调用点各自记得的事。
 *
 * <p>⚠️ 409（幂等键已存在）在这里被翻译成 `duplicated: true` 的**正常返回**，不是异常：
 *    重复的回调是必然会发生的（网关最多重投 6 次），把它当失败会让调用方反复重试、
 *    并把一次成功记成一次故障。
 */
export async function grantCredits(
  input: GrantCreditsInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrantCreditsResult> {
  const path = "/admin/credits/grants";
  const init: RequestInit & { env: NodeJS.ProcessEnv } = {
    method: "POST",
    body: JSON.stringify({
      userId: input.userId,
      source: "purchased",
      amount: input.credits,
      bizId: input.bizId,
      bizType: "recharge",
    }),
    env,
  };

  const response = await send(path, init);
  if (response.status === 409) {
    return { lotId: "", duplicated: true };
  }
  if (!response.ok) {
    throw new BillingAdminError(`发放积分失败：billing 管理端返回 HTTP ${response.status}`);
  }
  const data = (await response.json()) as { lotId?: number | string };
  return { lotId: String(data.lotId ?? ""), duplicated: false };
}

/* ---------- 传输 ---------- */

async function request<T>(
  path: string,
  init: RequestInit & { env: NodeJS.ProcessEnv },
): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) {
    throw new BillingAdminError(`billing 管理端 ${path} 返回 HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function send(
  path: string,
  init: RequestInit & { env: NodeJS.ProcessEnv },
): Promise<Response> {
  const { env, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  const traceId = getCurrentTraceId();
  if (traceId && !headers.has(TRACE_ID_HEADER)) headers.set(TRACE_ID_HEADER, traceId);
  return fetch(`${billingAdminUrl(env)}${path}`, {
    ...rest,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
}
