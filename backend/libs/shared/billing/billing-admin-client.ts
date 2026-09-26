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

/**
 * 目录文档被 billing **拒绝**（编译不过 / 不是合法 JSON）。
 *
 * <p>与 {@link BillingAdminError} 分开，因为处置方向相反：那个是「billing 出问题了，等它好」，
 * 这个是「**文档写错了，改文档**」——把编不过的目录当成服务故障，运维会去重启一个没坏的服务，
 * 而真正的错在眼前那份 JSON 里。所以这条必须把 billing 的原话（哪条规则、哪个维度）带上。
 */
export class CatalogRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogRejectedError";
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

/* ---------- 定价目录：读 / 发布 ---------- */

/**
 * `GET /admin/catalogs/active` 的回包。
 *
 * <p>`catalogVersion = -1` 表示**没有生效的目录**；此时 `document` 是空串
 * （与换算率同为 -1 同一个口径：不编造内容）。
 */
export interface ActiveCatalog {
  catalogVersion: number;
  /** 发布时对**提交文本**取的 SHA-256。⚠️ 与下面 `document` 的 hash 不相等，见其注释 */
  documentHash: string;
  /** 本版生效的规则条数 */
  /** 1 元 = 多少积分；没有生效目录时 -1 */
  creditsPerYuan: number;
  /**
   * 落库的目录文档文本。管理端「读回来改一改再整份发布」的起点。
   *
   * <p>⚠️ 它是 MySQL JSON 列的规范化形态，**不是**当初提交的那串字节 ——
   * 判断「内容改没改」必须解析成对象比，比文本会让一次没改过的保存凭空多出版本。
   */
  document: string;
}

/** 回包的宽容形态：对面是另一个进程，字段缺了不该在解析处炸，交给调用方按口径兜。 */
type ActiveCatalogResponse = Partial<ActiveCatalog>;

/**
 * 读当前生效的定价目录（含文档文本）。
 *
 * <p>与 {@link fetchCreditsPerYuan} 打同一个端点，区别只在**没有生效目录时怎么办**：
 * 充值路径取不到换算率就必须停（报不出价就别收钱），而管理端页面要能显示
 * 「还没发布过任何目录」并让运营从零建一份 —— 所以这条**不抛**，
 * 把 `catalogVersion = -1` 原样交给调用方判断。
 */
// ⚠️ 这里**没有** `ruleCount`：目录里曾经装着 13 条模型计价规则，那些规则已搬进模型能力行
//   （`generation_model_capability.pricing`），目录现在只装 `creditsPerYuan` 与 `discountPolicy`
//   两项全局配置，没有「规则条数」可报。billing 的响应里也一并删了这个字段。
export async function fetchActiveCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActiveCatalog> {
  const data = await request<ActiveCatalogResponse>("/admin/catalogs/active", {
    method: "GET",
    env,
  });
  return {
    catalogVersion: data.catalogVersion ?? -1,
    documentHash: data.documentHash ?? "",
    creditsPerYuan: data.creditsPerYuan ?? -1,
    document: data.document ?? "",
  };
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
  const rate = (await fetchActiveCatalog(env)).creditsPerYuan;
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new BillingAdminConfigError(
      `定价目录没有生效版本（creditsPerYuan=${rate}）：先发布一版目录再开充值`,
    );
  }
  return rate;
}

/** 发布目录的回包。`creditsPerYuan` 一并回来，运营不必再查一次库才知道发对了没有。 */
export interface PublishCatalogResult {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
}

export interface PublishCatalogInput {
  /** 目录文档**文本**（不是对象）。原样作为请求体发出去，理由见下面注释 */
  document: string;
  /** 谁发的，写进目录行的 `published_by`。事后要能回答「这版价是谁改的」 */
  publishedBy: string;
  note?: string;
}

/**
 * 发布一份定价目录（`POST /admin/catalogs`）。
 *
 * <p>⚠️ **请求体就是文档文本本身**，不是包一层的 `{"document": "..."}`：
 *    billing 那边存的是原文、对它取 hash，包一层就等于多一道「转义再解析」，
 *    出问题就无法与提交的内容逐字节比对。所以这里收 `string` 而不是 `object` ——
 *    序列化只发生一次（在调用方），中间没有任何人重新序列化它。
 *
 * @throws CatalogRejectedError 文档被拒（非法 JSON / 编译不过）—— 这是**改文档**的问题，
 *         不是等服务恢复，所以错误类型与 {@link BillingAdminError} 分开
 */
export async function publishCatalog(
  input: PublishCatalogInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublishCatalogResult> {
  const params = new URLSearchParams({ publishedBy: input.publishedBy });
  if (input.note) params.set("note", input.note);

  const response = await send(`/admin/catalogs?${params.toString()}`, {
    method: "POST",
    body: input.document,
    env,
  });
  if (response.status === 400) {
    // 编译是发布时**唯一**的校验时机（billing 侧），所以对面那句话就是「哪儿配错了」：
    // 丢掉它，运营看到的只剩「HTTP 400」，而能自己修的信息恰好只有这一句
    const detail = await errorDetail(response);
    throw new CatalogRejectedError(`目录被拒${detail}`);
  }
  if (!response.ok) {
    throw new BillingAdminError(
      `发布定价目录失败：billing 管理端返回 HTTP ${response.status}${await errorDetail(response)}`,
    );
  }
  const data = (await response.json()) as Partial<PublishCatalogResult>;
  return {
    catalogVersion: data.catalogVersion ?? -1,
    documentHash: data.documentHash ?? "",
    creditsPerYuan: data.creditsPerYuan ?? -1,
  };
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
  /**
   * 该行**当初冻了多少**（整数积分）。**只有消费行有值**，发放行与账本行为 `null`。
   *
   * ⚠️ `null` 不是 `0`：`0` 是「冻了 0 分」，`null` 是「这一行没有预扣这回事」。
   *    所以判空一律用 `== null`，不要用真值判断（`0` 会被误判成「没有」）。
   *
   * 为什么要读它：结算后 `amount` 已换成实际值，预扣额就只剩这里能答——用户余额先降后回
   * 的差额靠它解释。**与用户面无关**：UserTransaction 里没有这个字段，
   * 用户界面不会因此多出第二个金额。
   */
  reservedCredits: number | null;
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

/* ---------- 折扣：会员等级折扣 / 营销活动 ---------- */

/**
 * 折扣写入被 billing 拒了（400 + 一句人话：哪一列、为什么不合法）。
 *
 * <p>与 {@link CatalogRejectedError} 同一个立场：**这是「你填的不对」，不是「服务坏了」**。
 * 压成 503/500 会让运营去等服务恢复，而真正要改的是表单里的那个值。
 * billing 那边的校验文案是逐条写的（`DiscountRules`），原样带出来 —— 丢了它，
 * 界面上只剩「HTTP 400」，而能自己修的信息恰好只有这一句。
 */
export class DiscountRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountRejectedError";
  }
}

/**
 * 改/删的那条折扣已经不在了（404）。
 *
 * <p>与 {@link DiscountRejectedError} 分开：那个是「回去改表单」，这个是「刷新一下，
 * 别人已经删了」。两者的界面动作完全不同，混成一个码运营只能猜。
 */
export class DiscountNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountNotFoundError";
  }
}

/** 会员等级折扣（`billing_member_discounts` 的一行）。 */
export interface BillingMemberDiscount {
  id: number;
  /** free | basic | pro | max —— 权威定义在 `@lib/core/identity/tier` */
  tier: string;
  /** 模型匹配：`*` / `seedance-*` / 精确 id（**不支持中间带 \* **，billing 会拒） */
  modelPattern: string;
  /** 任务匹配：`*` / `text2video` */
  taskPattern: string;
  /** 万分比折扣，9000 = 9 折。⚠️ 界面按「折」展示，这一列是内部单位 */
  discountBp: number;
  /** 同等级命中多条时取最优惠；此项只用于展示排序 */
  priority: number;
  /** enabled | disabled */
  status: string;
  gmtCreate: string;
  gmtModified: string;
}

/**
 * 新建 / 整条覆盖一条会员折扣。
 *
 * <p>⚠️ **每一列都要给**（PUT 是整条覆盖，不是部分更新）：`priority` 与 `status`
 * 在 billing 侧有默认值（0 / enabled），但把「没给」与「给了个默认值」混在一起，
 * 就会出现「界面上看着是停用、库里其实还是启用」这类要靠读代码才能解释的差异。
 */
export interface MemberDiscountInput {
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
}

/**
 * 营销活动（`billing_promotions` 的一行）。
 *
 * <p>⚠️ 四个条件列（`modelIds` / `taskTypes` / `tierScope` / `daysOfWeek`）在这里是
 * **解析后的数组**，不是库里的 JSON 文本：文本形态对界面毫无意义，而
 * 「`[]`（= 全部）还是 `null`（= 不限）」的区别恰恰是最容易看错的一处。
 * billing 侧用与计价**同一份**解析器（`PatternJson`）。
 */
export interface BillingPromotion {
  id: number;
  /** 活动标识，唯一，审计/排查用 */
  code: string;
  name: string;
  /** 万分比折扣，7000 = 7 折 */
  discountBp: number;
  /** 模型范围，至少一个；`*` = 全部 */
  modelIds: string[];
  /** 任务范围；null = 不限 */
  taskTypes: string[] | null;
  /** 适用等级；null = 不限 */
  tierScope: string[] | null;
  /** 起始时间（含），无时区的墙钟：`2026-10-01T00:00:00` */
  startAt: string;
  /** 结束时间（**不含**） */
  endAt: string;
  /** 每日时段起；与 end 同时为 null = 全天 */
  dailyTimeStart: string | null;
  /** 每日时段止，可跨天（22:00→06:00） */
  dailyTimeEnd: string | null;
  /** 生效星期 [1..7]（1 = 周一）；null = 每天 */
  daysOfWeek: number[] | null;
  /** 时区（ADR-0111 北京时间口径），必填 */
  tz: string;
  /** draft | enabled | disabled | expired */
  status: string;
  priority: number;
  /** 建这条活动的人（backend 传当前管理员的 userId） */
  createdBy: string;
  gmtCreate: string;
  gmtModified: string;
}

/**
 * 新建 / 整条覆盖一条活动。**每一列都要给**（PUT 是整条覆盖），
 * `null` 是「不限 / 全天」这个明确的状态，不是「没填」。
 */
export interface PromotionInput {
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  /** null = 不限任务类型；billing 侧与空数组合一 */
  taskTypes: string[] | null;
  /** null = 不限等级 */
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  /** 两个都为 null = 全天；只给一个 billing 会拒（那在计价侧会静默变成全天） */
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  /** null = 每天 */
  daysOfWeek: number[] | null;
  tz: string;
  status: string;
  priority: number;
}

const MEMBER_DISCOUNTS_PATH = "/admin/member-discounts";
const PROMOTIONS_PATH = "/admin/promotions";

/** 列会员折扣。省略 tier / status = 全部（**停用的也列出来**，见 billing 侧的注释）。 */
export async function listMemberDiscounts(
  query: { tier?: string; status?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount[]> {
  const params = new URLSearchParams();
  if (query.tier) params.set("tier", query.tier);
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return discountRequest<BillingMemberDiscount[]>(
    `${MEMBER_DISCOUNTS_PATH}${qs ? `?${qs}` : ""}`,
    { method: "GET" },
    env,
  );
}

export async function createMemberDiscount(
  input: MemberDiscountInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount> {
  return discountRequest<BillingMemberDiscount>(
    MEMBER_DISCOUNTS_PATH,
    { method: "POST", body: JSON.stringify(input) },
    env,
  );
}

export async function updateMemberDiscount(
  id: number,
  input: MemberDiscountInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount> {
  return discountRequest<BillingMemberDiscount>(
    `${MEMBER_DISCOUNTS_PATH}/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    env,
  );
}

export async function deleteMemberDiscount(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await discountRequest<unknown>(`${MEMBER_DISCOUNTS_PATH}/${id}`, { method: "DELETE" }, env);
}

/** 列活动（含 draft / 停用 / 过期的：藏掉它们，运营会以为已经删了）。 */
export async function listPromotions(
  query: { status?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion[]> {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return discountRequest<BillingPromotion[]>(
    `${PROMOTIONS_PATH}${qs ? `?${qs}` : ""}`,
    { method: "GET" },
    env,
  );
}

/**
 * 新建活动。
 *
 * @param operator 当前管理员的 userId，写进 `created_by`。billing 的管理面**没有鉴权**，
 *                 它是唯一能回答「这条活动是谁建的」的来源，所以必须由这里带上。
 */
export async function createPromotion(
  input: PromotionInput,
  operator: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion> {
  const params = new URLSearchParams({ operator });
  return discountRequest<BillingPromotion>(
    `${PROMOTIONS_PATH}?${params.toString()}`,
    { method: "POST", body: JSON.stringify(input) },
    env,
  );
}

export async function updatePromotion(
  id: number,
  input: PromotionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion> {
  return discountRequest<BillingPromotion>(
    `${PROMOTIONS_PATH}/${id}`,
    { method: "PUT", body: JSON.stringify(input) },
    env,
  );
}

export async function deletePromotion(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await discountRequest<unknown>(`${PROMOTIONS_PATH}/${id}`, { method: "DELETE" }, env);
}

/**
 * 折扣接口的请求：把 billing 的失败**分类**成调用方能处置的三种。
 *
 * <p>⚠️ 这三个分类是这个文件里唯一重要的逻辑：400 是「改表单」、404 是「刷新」、
 * 其余是「等服务」。压成一个 Error 之后，管理端只能一律显示「操作失败」——
 * 而运营面对的那三种情况，要做的事完全不一样。
 */
async function discountRequest<T>(
  path: string,
  init: RequestInit,
  env: NodeJS.ProcessEnv,
): Promise<T> {
  const response = await send(path, { ...init, env });
  if (response.status === 400) {
    throw new DiscountRejectedError(`折扣配置被拒${await errorDetail(response)}`);
  }
  if (response.status === 404) {
    throw new DiscountNotFoundError(`目标不存在${await errorDetail(response)}`);
  }
  if (!response.ok) {
    throw new BillingAdminError(
      `计费管理端 ${path} 返回 HTTP ${response.status}${await errorDetail(response)}`,
    );
  }
  // DELETE 回 `{id, deleted}`，对调用方没有信息；统一按文本读再决定要不要解析
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
