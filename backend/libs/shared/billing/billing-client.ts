/* ============================================
 * billing-svc 的同步客户端（契约：contracts/proto/billing/v1/billing.proto）
 *
 * ⚠️ **只在用户等待路径上调 Hold**。结算/返还走 MQ，不在这里——它们不该阻塞任何请求。
 *    `quote` 也在用户等待路径上（生成前的价格）：它**只算不扣**，与余额无关，
 *    失败由调用方降级 —— 与 Hold 的 fail closed 不同，因为这条路径一分钱都不动。
 *
 * 读侧（`queryBalance` / `listTransactions`）是**用户账本的唯一出处**：余额与消费流水
 * 一律问 billing，不再问 new-api。new-api 已被切断，它那边的账单不再是我们的账。
 *
 * ⚠️ **fail closed，且没有开关**：契约写明「billing 不可用 → 调用方须拒绝提交」。
 *   扣不动就不要开始干活，避免「干了活却收不到钱」。
 *
 *   这里以前有一个 `BILLING_ENFORCE_HOLD` 开关，默认关闭；那是 new-api 还在替我们扣钱的
 *   时期的产物（同时扣会**扣两遍**）。new-api 已被切断，那个开关就变成了一条
 *   **静默的免费通道**——少配一个变量，全站生成都不扣钱且毫无报错。已整条删除。
 * ============================================ */
import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createClient, type Client } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import { NewApiError } from '@lib/core';
import {
  DomainError,
  ERROR_MODEL_UNAVAILABLE,
  ERROR_QUOTA_EXHAUSTED,
  errorCodeToNumeric,
} from '@lib/contracts';
import {
  BillingService,
  ListLotsRequestSchema,
  ListTransactionsRequestSchema,
  QueryBalanceRequestSchema,
  QuoteRequestSchema,
  type HoldRequest,
} from '../../contracts/gen/billing/v1/billing_pb.js';

export interface BillingHoldRequest {
  userId: number;
  /** ★ 幂等键来源，客户端生成 —— 不是 jobId（重试发生在写 job 之前） */
  commandId: string;
  jobId: number;
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  /** 用户等级：会员折扣与限等级活动要用。由调用方断言（它校验会话时已经拿到） */
  tier: string;
  title?: string;
  /** 计价规则快照（JSON 文本，形态 = 目录里 `models.<model_id>.<task_type>` 那条）。
   *  来自能力行的 `pricing` 列。**留空 = billing 回落目录**（过渡期兼容）。
   *  见 `contracts/proto/billing/v1/billing.proto` 的 `HoldRequest.rule_snapshot`。 */
  ruleSnapshot?: string;
}

export interface BillingHoldResult {
  /** 冻结到的**整数积分**（不是 mc） */
  reservedCredits: number;
  /** 定价版本 —— 须冻结进 job，结算时按它复现定价 */
  catalogVersion: number;
  /** 幂等命中：这次是重放，没有产生新的冻结 */
  duplicated: boolean;
}

export interface BillingQuoteRequest {
  userId: number;
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  /** 用户等级。**必须与 Hold 用同一个来源**（`identity.resolveTier`）：
   *  报价传 free 而预扣传 pro，用户就会看到「预览一个价、实扣另一个价」。 */
  tier: string;
  /** 规则快照；语义与 {@link BillingHoldRequest.ruleSnapshot} 逐条相同。
   *  预览与实扣必须取到**同一份**规则，否则「预览一个价、实扣另一个价」。 */
  ruleSnapshot?: string;
}

/**
 * 报价结果（`Quote` RPC）。**只算不扣** —— 不冻结、不产生流水。
 *
 * <p>⚠️ 单位是**整数积分**，与 Hold 的 `reservedCredits`、用户看到的账本是同一个数。
 * 这条路径不做任何换算（网关口径的 quota→分 是另一条链，见 billing-units-contract）。
 */
export interface BillingQuoteResult {
  /** 这个组合多少钱 —— 与用户有多少钱无关（余额校验是 Hold 的职责） */
  credits: bigint;
  /** 按哪一版定价目录报的价（溯源/对账用；结算按它复现） */
  catalogVersion: number;
}

/** 临期批次：前端展示「X 积分将于 Y 日过期」。`source` 决定展示文案（见 proto 注释）。 */
export interface BillingExpiringLot {
  credits: number;
  /** RFC3339 */
  expiresAt: string;
  source: string;
}

/**
 * 一个来源的可用积分（充值 / 充值赠送 / 每日赠送…）。
 *
 * <p>`source` 用的是**批次**的取名（`CreditSource.key()`：`purchased` / `bonus` / `daily`…），
 * 与流水那套（`recharge` / `bonus` / …）**不是同一组字面量**——展示文案按批次口径映射，
 * 别照抄 `BillingTransaction.type` 的表。
 */
export interface BillingSourceCredits {
  source: string;
  /** 该类可用积分 Σ(remaining − frozen)；全被冻结时为 0 */
  credits: number;
}

/** QueryBalance 的读侧形状。**单位一律是整数积分**，与用户看到的账本同一个数。 */
export interface BillingBalance {
  /** Σ(remaining − frozen) */
  availableCredits: number;
  frozenCredits: number;
  expiring: BillingExpiringLot[];
  /**
   * 可用积分**按来源拆开**。
   *
   * <p>⚠️ 它不是第二个金额，是 `availableCredits` 的分项：**Σ 必须等于它**
   * （服务端由同一条 SQL 的两种投影保证）。用户界面「总积分 = 各类型之和」
   * 靠的就是这个等式——前端相加与服务端总额对不上，就是 bug，不是口径差异。
   */
  bySource: BillingSourceCredits[];
}

/**
 * 用户可见流水的一行 —— 一个业务动作一行（proto `UserTransaction` 的镜像）。
 *
 * ⚠️ **刻意不含预扣额**：预扣值只对客服/运营后台可见（《计费逻辑详细设计》§2.3.1）。
 * `amount` 是这一行**唯一**的金额，`status` 表达它是不是最终值：
 * `pending` = 预计消耗，`done` = 实际消耗。
 */
export interface BillingTransaction {
  /** `lot:` / `res:` / `led:` 前缀 + 来源主键 —— 前缀不是装饰，三类来源 id 各自自增 */
  id: string;
  /** consume | recharge | refund | bonus | ... （见 proto 的 TransactionType 字面量） */
  type: string;
  direction: 'in' | 'out';
  title: string;
  /** 整数积分，该行唯一的金额（语义随 status） */
  credits: number;
  status: 'pending' | 'done';
  /** RFC3339 */
  createdAt: string;
  /** RFC3339，仅 done 时非空 */
  settledAt: string;
  /**
   * 关联的生成任务 id；发放行 / 过期行没有任务，为 `null`。
   *
   * ⚠️ 它只是**一个 id**：任务的类型 / 模型 / 提示词在 backend 自己的库里（ADR-0114 不共享库，
   * billing 读不到）。要显示那几列，调用方拿批 id 走 `JobsService.loadTaskSummaries` 补。
   *
   * ⚠️ 是 **string** 不是 number：id 在契约里是 int64，超过 `Number.MAX_SAFE_INTEGER` 时
   * number 会静默取整成另一个 id。与 `billing-admin-client.ts` 同一口径（那边早就这么做了），
   * 两处不一致会让同一个 id 在两条链路上长得不一样。
   */
  generationJobId: string | null;
}

/**
 * 流水分页 —— **offset 页码 + 总数**。
 *
 * <p>⚠️ 2026-09-30 由游标改为 offset。此前这里写的是「账本持续新增，offset 会漏行，
 * 所以契约里没给总数」。**代价仍然存在**：`total` 与 `items` 是分两次读的，翻页途中有人
 * 充值就会出现「本页行数 < 总数」这类不同步。产品接受它，换的是列表上的「共 N 条」与页码。
 * 留痕见《通用积分卡「账户积分与订单」页前端对接文档》§6.2。
 */
export interface BillingTransactionPage {
  items: BillingTransaction[];
  /** 满足同一组条件的总条数。**不要**拿它与 `items.length` 比对来推断有没有下一页 */
  total: number;
}

export interface BillingListTransactionsQuery {
  userId: number;
  /**
   * 类型过滤（consume | recharge | refund | expire | ...），空数组 = 全部。
   *
   * ⚠️ **每一个值都会被校验**：未知类型会被 billing 拒成 INVALID_ARGUMENT
   * （而不是静默返回空列表）——刻意的，空列表与「真的没有」长得一样。
   * 多值用于用户的「已消耗」页签（一次取 `consume` 与 `expire`）。
   */
  typeFilters?: string[];
  /** 上限由 billing 钳制 */
  pageSize?: number;
  /** 页码，从 1 起；不传 = 首页 */
  page?: number;
}

export interface BillingClient {
  hold(request: BillingHoldRequest): Promise<BillingHoldResult>;
  /** 报价（只算不扣）。生成前的价格预览走它 —— 与 Hold 同一套规格与等级。 */
  quote(request: BillingQuoteRequest): Promise<BillingQuoteResult>;
  queryBalance(userId: number): Promise<BillingBalance>;
  listTransactions(query: BillingListTransactionsQuery): Promise<BillingTransactionPage>;
  listCreditLots(query: BillingListLotsQuery): Promise<BillingCreditLotPage>;
}

/**
 * 一个积分**批次**（积分明细「已获取」页签）。
 *
 * <p>与 {@link BillingTransaction} 是两个维度：流水「一个业务动作一行」，批次「一笔发放一行」。
 * **到期明细只有批次给得出** —— 流水行没有 `expiresAt`。
 */
export interface BillingCreditLot {
  lotId: string;
  /**
   * **批次口径**的来源：`purchased | bonus | gift | daily | invite | register | redeem |
   * subscription | compensation`。
   *
   * ⚠️ 与流水口径**用词不同**：批次写 `purchased`，`BillingTransaction.type` 写 `recharge`。
   * 同一件事两个词，前端不要拿同一张文案表去套。
   */
  source: string;
  /** 发放时的原始积分 */
  amount: number;
  /**
   * 该批尚未消耗的**可用量**（上游已按 `remaining − frozen` 算好）。
   *
   * ⚠️ 冻结中的部分**不在里面**：预扣已经把这笔钱许给在途任务了，对用户来说不能用。
   */
  remaining: number;
  /** RFC3339，发放时刻 */
  createdAt: string;
  /** RFC3339；**空串 = 永久有效**（proto3 的 string 没有 null，空串是唯一的「没有」） */
  expiresAt: string;
  /** 业务类型（recharge / …）；无关联时为空串 */
  bizType: string;
  /** 关联单号（充值批次 = 订单号）；无关联时为空串 */
  bizId: string;
}

/** 台账的一页。`total` 是该用户**全部**批次条数，不是本页条数。 */
export interface BillingCreditLotPage {
  items: BillingCreditLot[];
  total: number;
}

export interface BillingListLotsQuery {
  /**
   * ⚠️ **必填，且只能填会话解析出来的那个 id**。
   *
   * <p>这条是用户面取数，**没有「不限用户」模式** —— 上游对 `<= 0` 直接返回
   * INVALID_ARGUMENT，而不是「查全部」。与运营面 `listAdminTransactions` 的
   * 「0 = 全站」是两回事，别照着那边抄。
   */
  userId: number;
  /** 上限由 billing 钳制 */
  pageSize?: number;
  /** 页码，从 1 起；不传 = 首页 */
  page?: number;
}

/** billing 的 gRPC 地址。 */
export const BILLING_URL_ENV = "BILLING_GRPC_URL";

/**
 * 上游/计费的配置缺失。
 *
 * <p>单独一个类型而不是抛通用 Error：调用方要能把它翻成「部署配错了」，
 * 而不是「服务挂了」——两者的处置完全不同。
 */
export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

/**
 * 取 billing 的 gRPC 地址。
 *
 * <p>⚠️ **未配置时抛错，不返回空串**。曾经的做法是「空地址 = 没有客户端 = 跳过预扣」，
 * 那在切换前是对的（new-api 还在扣），但在 new-api 被切断之后，它就是一条
 * **静默的免费通道**：少配一个环境变量，全站生成都不扣钱，而且没有任何报错。
 *
 * <p>所以现在没有「没有客户端」这个状态了——预扣是提交生成的必经一步，
 * 配不出地址就不该能提交。
 */
export function billingEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const url = (env[BILLING_URL_ENV] ?? "").trim();
  if (!url) {
    throw new BillingConfigError(
      `计费服务地址未配置（缺环境变量 ${BILLING_URL_ENV}）：提交生成必须能预扣，` +
        `不能在没有计费服务的情况下放行`,
    );
  }
  return url;
}

/**
 * 启动期断言：计费依赖齐备。
 *
 * <p>放在启动而不是首次请求：一个扣不了钱的进程**不该开始接受生成请求**。
 * 等到第一个用户提交才报错，那段时间里已经在白跑了。
 *
 * <p>⚠️ **上游凭证曾经也在这里，现在不在了**。它当时被算进来的理由是「缺它登录就签发不出
 *    会话」——那把 key 现在配在 `system_settings`（管理端可配），不在环境变量里；而
 *    「还没配」是**数据没填**，不是**部署配错**。把它留在启动门禁里会把新部署卡成死循环：
 *    key 要在管理端填，管理端要先登得进来，而进程根本不起。
 *    它的 fail-closed 改落在**真正打上游的地方**（下游 `parseBearerToken` 拿到 null 即 401、
 *    调用点抛 `UpstreamCredentialMissingError` 503），拿不到 key 绝不发空串出去。
 *
 * @returns 缺的东西（空数组 = 齐备）。返回而不是抛，是因为调用方
 *          （bootstrap）要先把它和别的启动检查汇总成一条日志再决定退不退。
 */
export function missingBillingConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!(env[BILLING_URL_ENV] ?? "").trim()) missing.push(BILLING_URL_ENV);
  return missing;
}

export function createBillingClient(baseUrl: string): BillingClient {
  const client: Client<typeof BillingService> = createClient(
    BillingService,
    // gRPC 协议（billing 的 server 是普通 gRPC，不是 Connect/gRPC-Web）
    createGrpcTransport({ baseUrl }),
  );

  return {
    async hold(request) {
      const message: HoldRequest = {
        userId: BigInt(request.userId),
        commandId: request.commandId,
        jobId: BigInt(request.jobId),
        modelId: request.modelId,
        taskType: request.taskType,
        specs: { attrs: request.specs },
        tier: request.tier,
        title: request.title ?? '',
        ruleSnapshot: request.ruleSnapshot ?? '',
      } as HoldRequest;

      const response = await client.hold(message);
      return {
        reservedCredits: Number(response.reservedCredits),
        catalogVersion: response.catalogVersion,
        duplicated: response.duplicated,
      };
    },

    async quote(request) {
      // 不带 usage = 按契约用量报价（提交前预览）；带真实用量是结算/影子对账的事。
      const response = await client.quote(
        create(QuoteRequestSchema, {
          userId: BigInt(request.userId),
          modelId: request.modelId,
          taskType: request.taskType,
          specs: { attrs: request.specs },
          tier: request.tier,
          ruleSnapshot: request.ruleSnapshot ?? '',
        }),
      );
      return {
        // 不做 Number() 折算：这是要落 BigInt 列的账本金额，原样保精度
        credits: response.credits,
        catalogVersion: response.catalogVersion,
      };
    },

    async queryBalance(userId) {
      const response = await client.queryBalance(
        create(QueryBalanceRequestSchema, { userId: BigInt(userId) }),
      );
      return {
        availableCredits: Number(response.availableCredits),
        frozenCredits: Number(response.frozenCredits),
        expiring: response.expiring.map((lot) => ({
          credits: Number(lot.credits),
          expiresAt: lot.expiresAt,
          source: lot.source,
        })),
        bySource: response.bySource.map((item) => ({
          source: item.source,
          credits: Number(item.credits),
        })),
      };
    },

    async listTransactions(query) {
      const response = await client.listTransactions(
        create(ListTransactionsRequestSchema, {
          userId: BigInt(query.userId),
          typeFilters: query.typeFilters ?? [],
          ...(query.pageSize === undefined && query.page === undefined
            ? {}
            : {
                page: {
                  pageSize: query.pageSize ?? 0,
                  page: query.page ?? 0,
                },
              }),
        }),
      );
      return {
        items: response.items.map((item) => ({
          id: item.id,
          type: item.type,
          direction: item.direction === 'in' ? 'in' : 'out',
          title: item.title,
          credits: Number(item.amount),
          status: item.status === 'done' ? 'done' : 'pending',
          createdAt: item.createdAt,
          settledAt: item.settledAt,
          // proto3 optional：未设置 = 这一行没有任务（发放行 / 过期行）。判 undefined，
          // 不是真值判断——`0n` 也是 falsy，那会把一个合法的 job 0 当成「没有」
          generationJobId:
            item.generationJobId === undefined ? null : String(item.generationJobId),
        })),
        // 用户面 billing **一定**填 total（运营面才留空），所以这里给 number 而不是可空。
        // 真出现 undefined 只可能是契约被改坏了，Number(undefined)=NaN 会立刻在断言里炸出来
        total: Number(response.page?.total ?? 0),
      };
    },

    async listCreditLots(query) {
      const response = await client.listLots(
        create(ListLotsRequestSchema, {
          // ⚠️ 用户 id 只来自调用方（backend 从会话解析后传入）。这里**不兜底成 0** ——
          //    上游对 <= 0 会拒，而「静默传一个 0 看看」正是不该在这里发生的事
          userId: BigInt(query.userId),
          page: {
            pageSize: query.pageSize ?? 0,
            page: query.page ?? 0,
          },
        }),
      );
      return {
        items: response.items.map((item) => ({
          lotId: item.lotId,
          source: item.source,
          amount: Number(item.amount),
          remaining: Number(item.remaining),
          createdAt: item.createdAt,
          // 空串就是「永久有效」，**不转成 null**：proto3 的 string 只有这一种「没有」，
          // 在这里再引入第二种只会让前端多判一次
          expiresAt: item.expiresAt,
          bizType: item.bizType,
          bizId: item.bizId,
        })),
        total: Number(response.page?.total ?? 0),
      };
    },
  };
}

/**
 * 进程内共享的 billing 客户端。
 *
 * <p>客户端是无状态的（一次 gRPC transport + 一组方法），每次请求新建只会白白多一条连接，
 * 所以这里缓存一份。地址仍由 {@link billingEndpoint} 权威解析：**没配就抛**，
 * 不存在「没有客户端」这个状态。
 */
let sharedClient: BillingClient | undefined;

export function sharedBillingClient(): BillingClient {
  if (!sharedClient) {
    sharedClient = createBillingClient(billingEndpoint());
  }
  return sharedClient;
}

/**
 * billing 调用失败 → HTTP 信封错误。
 *
 * <p>**不透传 gRPC 原始文案**：那是内部地址、栈信息与 proto 细节，对用户没有意义，
 * 也不能当成「这个数查不出来」的解释。留给客户端的只有一句「暂不可用」+ 可重试的 503。
 *
 * <p>配置缺失（{@link BillingConfigError}）单独翻成 503：那是**部署配错了**，
 * 与「billing 挂了」处置不同，但都不是用户能自己解决的，所以同样是 503 而不是 500。
 */
export function toBillingError(error: unknown, fallbackMessage: string): NewApiError {
  if (error instanceof BillingConfigError) {
    return new NewApiError(error.message, 503, 'billing_unconfigured');
  }
  if (error instanceof ConnectError) {
    const unavailable =
      error.code === Code.Unavailable || error.code === Code.DeadlineExceeded;
    return new NewApiError(
      fallbackMessage,
      unavailable ? 503 : 502,
      unavailable ? 'billing_unavailable' : 'billing_error',
    );
  }
  return new NewApiError(fallbackMessage, 502, 'billing_error');
}

/**
 * billing 把失败原因词拼在 gRPC status description 的**前缀**上（`<REASON>: <中文说明>`），
 * 服务端那侧见 `BillingGrpcService` 的异常映射；这两个词是契约里逐字写下的。
 */
const REASON_INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS';
const REASON_UNPRICEABLE = 'UNPRICEABLE';

/** billing 不可用时对外说的那句话。原始文案（含内部原因词）只进日志，不进响应。 */
const BILLING_UNAVAILABLE_MESSAGE = '计费服务暂不可用，请稍后重试';

/**
 * 预扣（Hold）被拒 → 对外错误；**认不出的返回 null**，调用点照原样抛。
 *
 * <p>契约（contracts/proto/billing/v1/billing.proto）把 Hold 的失败分成三条语义：
 *
 * <pre>
 *   - 余额不足        → FAILED_PRECONDITION / INSUFFICIENT_CREDITS
 *   - 该组合算不出价  → INVALID_ARGUMENT / UNPRICEABLE（说明**定价漏配**）
 *   - billing 不可用  → UNAVAILABLE
 * </pre>
 *
 * <p>⚠️ **三条都仍然是拒绝**（fail closed 不变，见 billing-hold.ts）：变的只是
 * 「**以什么状态、什么话**被拒」。此前它们原样冒泡到异常过滤器，一律落进「未处理异常」兜底
 * 500 —— 用户看到的是一句「服务器内部错误」，像是我们挂了；而真相是「这个模型没配价，
 * 换一个就行」，运营该去补价。两种人都需要一句能读的话。
 *
 * <p>⚠️ **原因词不外泄**：`UNPRICEABLE` / `INSUFFICIENT_CREDITS` 是给我们看的（日志里原样
 * 留着，漏配清单就是从这批日志里攒出来的），响应里只出现码表那句中文。
 *
 * <p>Quote 不走这里：它的失败是**降级**（不阻断提交），且它的日志正是漏配清单的来源，
 * 映射掉就丢了原文（见 billing-quote.ts）。
 */
export function toBillingHoldError(error: unknown): DomainError | NewApiError | null {
  // 这个客户端只抛 ConnectError。别的东西（比如我们自己的转换错误）是**我们自己的 bug**，
  // 伪装成「上游故障」只会让排查方向跑偏 —— 认不出就返回 null，让它照旧是 500。
  if (!(error instanceof ConnectError)) return null;

  // 客户端这侧的原文是 rawMessage：message 还带着 `[invalid_argument] ` 前缀，
  // 原因词在服务端拼的描述里。
  const reason = error.rawMessage.toUpperCase();

  // 码与原因词**一起判**：只看 code 会把「参数写错了」那类 INVALID_ARGUMENT 也算成业务语义，
  // 而那是我方请求本身有问题，不是用户能处理的事（走下面的兜底）。
  if (error.code === Code.FailedPrecondition && reason.includes(REASON_INSUFFICIENT_CREDITS)) {
    // 402 + 码表 1001 那句「账户余额不足，请充值后重试」（1001 → 402 的投影见 error-codes.ts）。
    return new DomainError(errorCodeToNumeric(ERROR_QUOTA_EXHAUSTED));
  }
  if (error.code === Code.InvalidArgument && reason.includes(REASON_UNPRICEABLE)) {
    // 算不出价 = **定价漏配**。对用户是 4xx：「这个模型现在用不了，换一个」是他能自己做的事。
    // 文案复用码表既有的 model_unavailable（1005）—— 提交口「模型不在启用目录」用的是同码
    // 同句，对用户而言两种原因的处置是同一个动作。
    return new DomainError(errorCodeToNumeric(ERROR_MODEL_UNAVAILABLE));
  }

  // 其余按既有读侧口径：UNAVAILABLE/DeadlineExceeded → 503（重试有意义），
  // billing 内部错误 → 502。原始文案一律不透传。
  return toBillingError(error, BILLING_UNAVAILABLE_MESSAGE);
}
