/* ============================================
 * billing-svc 的同步客户端（契约：contracts/proto/billing/v1/billing.proto）
 *
 * ⚠️ **只在用户等待路径上调 Hold**。结算/返还走 MQ，不在这里——它们不该阻塞任何请求。
 *
 * ⚠️ **fail closed，且没有开关**：契约写明「billing 不可用 → 调用方须拒绝提交」。
 *   扣不动就不要开始干活，避免「干了活却收不到钱」。
 *
 *   这里以前有一个 `BILLING_ENFORCE_HOLD` 开关，默认关闭；那是 new-api 还在替我们扣钱的
 *   时期的产物（同时扣会**扣两遍**）。new-api 已被切断，那个开关就变成了一条
 *   **静默的免费通道**——少配一个变量，全站生成都不扣钱且毫无报错。已整条删除。
 * ============================================ */
import { createClient, type Client } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import {
  BillingService,
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

export interface BillingClient {
  hold(request: BillingHoldRequest): Promise<BillingHoldResult>;
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
  };
}
