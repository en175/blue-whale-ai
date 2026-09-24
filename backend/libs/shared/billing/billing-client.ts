/* ============================================
 * billing-svc 的同步客户端（契约：contracts/proto/billing/v1/billing.proto）
 *
 * ⚠️ **只在用户等待路径上调 Hold**。结算/返还走 MQ，不在这里——它们不该阻塞任何请求。
 *
 * ⚠️ **fail closed**：契约写明「billing 不可用 → 调用方须拒绝提交」。
 *   扣不动就不要开始干活，避免「干了活却收不到钱」。唯一例外见 DEFAULT_ENFORCE 的说明。
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

/**
 * 是否**强制**预扣。
 *
 * ⚠️ 默认 **false**，理由只有一条：切换前 billing 一旦真扣，new-api 那边还在扣用户的钱，
 *    **用户会被扣两遍**（《迁移与切换 runbook》§3.1）。
 *    所以这条路径先接好、开着开关能跑，但在断 sk- 链之前必须保持关闭。
 *
 * 打开它 = 宣布「我们开始自己扣钱了」，必须与断链**同一发布窗口**执行。
 */
export const DEFAULT_ENFORCE = false;

export function enforceHold(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BILLING_ENFORCE_HOLD === 'true';
}

/** billing 的 gRPC 地址；未配置时不存在客户端。 */
export function billingEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BILLING_GRPC_URL ?? '').trim();
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
