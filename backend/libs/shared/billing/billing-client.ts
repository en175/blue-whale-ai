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
  BillingService,
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

/** QueryBalance 的读侧形状。**单位一律是整数积分**，与用户看到的账本同一个数。 */
export interface BillingBalance {
  /** Σ(remaining − frozen) */
  availableCredits: number;
  frozenCredits: number;
  expiring: BillingExpiringLot[];
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
}

/**
 * 流水分页 —— **游标，不是页码**。
 *
 * <p>账本持续新增，offset 分页会漏行或重复行，所以契约里就没给总数：要准确总数就得扫全表，
 * 而扫完那一刻它又变了。调用方只应把 `nextPageToken` 原样回传（游标内容是排序键，是存储细节）。
 */
export interface BillingTransactionPage {
  items: BillingTransaction[];
  /** 空串 = 没有下一页 */
  nextPageToken: string;
}

export interface BillingListTransactionsQuery {
  userId: number;
  /**
   * 单值类型过滤（consume | recharge | refund | ...），空串 = 全部。
   *
   * ⚠️ 只能传**一个**类型。上游不认识逗号分隔，拼错一个字母会被 billing 拒成
   * INVALID_ARGUMENT（而不是静默返回空列表）——刻意的，空列表与「真的没有」长得一样。
   */
  typeFilter?: string;
  /** 上限由 billing 钳制 */
  pageSize?: number;
  /** 上一页返回的游标；空 = 首页 */
  pageToken?: string;
}

export interface BillingClient {
  hold(request: BillingHoldRequest): Promise<BillingHoldResult>;
  /** 报价（只算不扣）。生成前的价格预览走它 —— 与 Hold 同一套规格与等级。 */
  quote(request: BillingQuoteRequest): Promise<BillingQuoteResult>;
  queryBalance(userId: number): Promise<BillingBalance>;
  listTransactions(query: BillingListTransactionsQuery): Promise<BillingTransactionPage>;
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
 * @returns 缺的东西（空数组 = 齐备）。返回而不是抛，是因为调用方
 *          （bootstrap）要先把它和别的启动检查汇总成一条日志再决定退不退。
 */
export function missingBillingConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!(env[BILLING_URL_ENV] ?? "").trim()) missing.push(BILLING_URL_ENV);
  if (!(env.NEW_API_UPSTREAM_KEY ?? "").trim()) missing.push("NEW_API_UPSTREAM_KEY");
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
      };
    },

    async listTransactions(query) {
      const response = await client.listTransactions(
        create(ListTransactionsRequestSchema, {
          userId: BigInt(query.userId),
          typeFilter: query.typeFilter ?? '',
          ...(query.pageSize === undefined && query.pageToken === undefined
            ? {}
            : {
                page: {
                  pageSize: query.pageSize ?? 0,
                  pageToken: query.pageToken ?? '',
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
        })),
        nextPageToken: response.page?.nextPageToken ?? '',
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
