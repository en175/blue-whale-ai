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

/* ---------- 账本：读流水（管理端全局） ---------- */

/** `GET /admin/transactions` 的一行。字段口径同 `UserTransaction`，多一个 `userId`。 */
export interface AdminTransactionItem {
  /** 形如 `lot:12` / `res:7` / `led:expire:...`，三类来源全局唯一 */
  id: string;
  /** 归属用户。**管理面独有的列**——契约的 UserTransaction 没有它（用户只看自己那份） */
  userId: number;
  type: string;
  direction: string;
  title: string;
  /** **整数积分**，该行唯一的金额（status=pending 时是预计消耗，done 时是实际消耗） */
  amount: number;
  status: string;
  createdAt: string;
  /** RFC3339；未结算为空串 */
  settledAt: string;
}

export interface AdminTransactionPage {
  items: AdminTransactionItem[];
  /** 空串 = 没有下一页 */
  nextPageToken: string;
}

export interface AdminTransactionsQuery {
  /** 不传 = **全站流水**。这条自由度只有管理面有：用户面的 ListTransactions 里 userId 是必填的 */
  userId?: number;
  /** 单值（consume | recharge | ...），空 = 全部。未知类型 billing 会返回 400 */
  type?: string;
  pageSize?: number;
  /** 上一页给的 nextPageToken，原样回传；空 = 首页 */
  pageToken?: string;
}

/**
 * 读全站/按用户流水（`GET /admin/transactions`）。
 *
 * <p>⚠️ **不复用 gRPC 的 `ListTransactions`**：那条契约里 `user_id` 是必填的，
 *    语义是「把我的账给我」。管理端要的「某个人的 / 所有人一起看」它答不了，
 *    而给用户面契约加「userId 可不填」等于给每个持 token 的调用者开了拉全站流水的口子。
 *    所以管理面另开一条 HTTP，proto 一个字没动。
 *
 * <p>⚠️ 分页是**游标**、**没有总数**（账本持续追加，要准确总数就得扫全表，
 *    而扫完那一刻它又变了）。所以「上一页」得靠调用方自己存游标栈，
 *    不能像本地表那样算页码。
 */
export async function listAdminTransactions(
  query: AdminTransactionsQuery = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminTransactionPage> {
  const params = new URLSearchParams();
  if (query.userId !== undefined) params.set("userId", String(query.userId));
  if (query.type) params.set("type", query.type);
  if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
  if (query.pageToken) params.set("pageToken", query.pageToken);
  const qs = params.toString();
  return request<AdminTransactionPage>(
    `/admin/transactions${qs ? `?${qs}` : ""}`,
    { method: "GET", env },
  );
}

/* ---------- 账本：读聚合（管理端） ---------- */

/** `GET /admin/transactions/consumed-credits` 的回包。 */
interface ConsumedCreditsResponse {
  consumedCredits?: number;
}

/**
 * 读区间内**已结算的实际消耗积分合计**（`GET /admin/transactions/consumed-credits`）。
 *
 * <p>⚠️ **不复用逐行的 {@link listAdminTransactions} 再自己累加**，理由三条：
 * <ol>
 *   <li>流水是**游标分页、无总数**（账本持续追加，给不出总数）。要累加就得把整个区间
 *       一页页拉完，每页最多 100 行——区间一大就是几十次跨进程往返，而仪表盘每次打开
 *       都要跑一遍。</li>
 *   <li>逐行那条 SQL 是「批次 ∪ 预留 ∪ 账本凭证」的三路 UNION，还带 GROUP BY。
 *       为求一个和而反复跑它，比在预留表上做一次索引区间扫描贵得多。</li>
 *   <li><b>最要命的是它会静默算错</b>：翻到一半失败（超时、进程重启、游标坏掉）时
 *       前面的页已经加进去了——得到的「总消耗」偏小，而偏小的总数与真实总数在界面上
 *       长得一模一样。聚合在一条 SQL 里要么全对、要么报错。</li>
 * </ol>
 *
 * <p>口径：只算 `status = 'settled'` 的预留行（取 {@code actual_credits} 这个最终值）。
 * `held` 的钱还冻着、`released` 的钱原样退回，两者都**不是**消耗。
 *
 * @param from 区间起点（含）
 * @param to   区间终点（**不含**）——半开区间，理由见 `dashboard-range.ts` 的文件头
 */
export async function fetchConsumedCredits(
  from: Date,
  to: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const params = new URLSearchParams({ from: rfc3339(from), to: rfc3339(to) });
  const data = await request<ConsumedCreditsResponse>(
    `/admin/transactions/consumed-credits?${params.toString()}`,
    { method: "GET", env },
  );
  const credits = data.consumedCredits;
  if (typeof credits !== "number" || !Number.isFinite(credits)) {
    // 缺字段 / 非数字一律当失败：回落到 0 会得到一句「这段时间没人消费」的假话
    throw new BillingAdminError(
      `billing 管理端 /admin/transactions/consumed-credits 回包缺 consumedCredits：` +
        JSON.stringify(data),
    );
  }
  return credits;
}

/**
 * 瞬时 → 带 **+08:00 偏移**的 RFC3339。
 *
 * <p>`toISOString()` 也表达同一个瞬时，但它会把「北京零点」写成**前一天的 UTC 16:00**——
 * 排查时对着日志要心算 8 小时，而这条请求的参数恰恰**就是**我们精心算出来的北京日界。
 * 带上偏移，日志里读到的就是我们想表达的那个日子。
 */
function rfc3339(instant: Date): string {
  const beijing = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  return `${beijing.toISOString().slice(0, 19)}+08:00`;
}

/* ---------- 传输 ---------- */

async function request<T>(
  path: string,
  init: RequestInit & { env: NodeJS.ProcessEnv },
): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) {
    throw new BillingAdminError(
      `billing 管理端 ${path} 返回 HTTP ${response.status}${await errorDetail(response)}`,
    );
  }
  return (await response.json()) as T;
}

/**
 * 取错误响应体里的 `message` 拼成 `：xxx`（billing 的 AdminExceptionHandler 统一回 `{code,message}`）。
 *
 * <p>没有它，一个 400 在日志与页面上都只是「HTTP 400」——而它恰恰是**能自己改**的那一类错
 * （比如类型过滤传错、游标坏了），看得到原因才修得动。
 *
 * <p>读不出来就返回空串：**附带信息失败不该盖掉主错误**。
 */
async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown };
    return typeof body.message === "string" && body.message ? `：${body.message}` : "";
  } catch {
    return "";
  }
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
