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
  type ChargeRequest,
} from '../../contracts/gen/billing/v1/billing_pb.js';

export interface BillingChargeRequest {
  userId: number;
  commandId: string;
  jobId: number;
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  tier: string;
  title?: string;
  ruleSnapshot?: string;
}

export interface BillingChargeResult {
  chargedCredits: number;
  catalogVersion: number;
  duplicated: boolean;
}

export interface BillingQuoteRequest {
  userId: number;
  modelId: string;
  taskType: string;
  specs: Record<string, string>;
  tier: string;
  ruleSnapshot?: string;
}

export interface BillingQuoteResult {
  credits: bigint;
  catalogVersion: number;
}

export interface BillingExpiringLot {
  credits: number;
  expiresAt: string;
  source: string;
}

export interface BillingSourceCredits {
  source: string;
  credits: number;
}

export interface BillingBalance {
  availableCredits: number;
  expiring: BillingExpiringLot[];
  bySource: BillingSourceCredits[];
}

export interface BillingTransaction {
  id: string;
  type: string;
  direction: 'in' | 'out';
  title: string;
  credits: number;
  status: 'pending' | 'done';
  createdAt: string;
  settledAt: string;
  generationJobId: string | null;
  lotSource: string;
  lotCreatedAt: string;
  chargeState?: string;
}

export interface BillingTransactionPage {
  items: BillingTransaction[];
  total: number;
}

export interface BillingListTransactionsQuery {
  userId: number;
  typeFilters?: string[];
  createdFrom?: string;
  createdTo?: string;
  generationJobIds?: string[];
  pageSize?: number;
  page?: number;
}

export interface BillingClient {
  charge(request: BillingChargeRequest): Promise<BillingChargeResult>;
  quote(request: BillingQuoteRequest): Promise<BillingQuoteResult>;
  queryBalance(userId: number): Promise<BillingBalance>;
  listTransactions(query: BillingListTransactionsQuery, options?: { timeoutMs: number }): Promise<BillingTransactionPage>;
  listCreditLots(query: BillingListLotsQuery): Promise<BillingCreditLotPage>;
}

export interface BillingCreditLot {
  lotId: string;
  source: string;
  amount: number;
  remaining: number;
  createdAt: string;
  expiresAt: string;
  bizType: string;
  bizId: string;
}

export interface BillingCreditLotPage {
  items: BillingCreditLot[];
  total: number;
}

export interface BillingListLotsQuery {
  userId: number;
  createdFrom?: string;
  createdTo?: string;
  pageSize?: number;
  page?: number;
}

export const BILLING_URL_ENV = "BILLING_GRPC_URL";

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

export function billingEndpoint(env: NodeJS.ProcessEnv = process.env): string {
  const url = (env[BILLING_URL_ENV] ?? "").trim();
  if (!url) {
    throw new BillingConfigError(
      `计费服务地址未配置（缺环境变量 ${BILLING_URL_ENV}）：提交生成必须能扣款，` +
        `不能在没有计费服务的情况下放行`,
    );
  }
  return url;
}

export function missingBillingConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!(env[BILLING_URL_ENV] ?? "").trim()) missing.push(BILLING_URL_ENV);
  return missing;
}

export function createBillingClient(baseUrl: string): BillingClient {
  const client: Client<typeof BillingService> = createClient(
    BillingService,
    createGrpcTransport({ baseUrl }),
  );

  return {
    async charge(request) {
      const message: ChargeRequest = {
        userId: BigInt(request.userId),
        commandId: request.commandId,
        jobId: BigInt(request.jobId),
        modelId: request.modelId,
        taskType: request.taskType,
        specs: { attrs: request.specs },
        tier: request.tier,
        title: request.title ?? '',
        ruleSnapshot: request.ruleSnapshot ?? '',
      } as ChargeRequest;

      const response = await client.charge(message);
      return {
        chargedCredits: Number(response.chargedCredits),
        catalogVersion: response.catalogVersion,
        duplicated: response.duplicated,
      };
    },

    async quote(request) {
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

    async listTransactions(query, options) {
      const response = await client.listTransactions(
        create(ListTransactionsRequestSchema, {
          userId: BigInt(query.userId),
          typeFilters: query.typeFilters ?? [],
          createdFrom: query.createdFrom ?? '',
          createdTo: query.createdTo ?? '',
          generationJobIds: (query.generationJobIds ?? []).map((id) => BigInt(id)),
          ...(query.pageSize === undefined && query.page === undefined
            ? {}
            : {
                page: {
                  pageSize: query.pageSize ?? 0,
                  page: query.page ?? 0,
                },
              }),
        }),
        options,
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
          generationJobId:
            item.generationJobId === undefined ? null : String(item.generationJobId),
          lotSource: item.lotSource,
          lotCreatedAt: item.lotCreatedAt,
          chargeState: item.chargeState,
        })),
        total: Number(response.page?.total ?? 0),
      };
    },

    async listCreditLots(query) {
      const response = await client.listLots(
        create(ListLotsRequestSchema, {
          userId: BigInt(query.userId),
          createdFrom: query.createdFrom ?? '',
          createdTo: query.createdTo ?? '',
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
          expiresAt: item.expiresAt,
          bizType: item.bizType,
          bizId: item.bizId,
        })),
        total: Number(response.page?.total ?? 0),
      };
    },
  };
}

let sharedClient: BillingClient | undefined;

export function sharedBillingClient(): BillingClient {
  if (!sharedClient) {
    sharedClient = createBillingClient(billingEndpoint());
  }
  return sharedClient;
}

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

const REASON_INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS';
const REASON_UNPRICEABLE = 'UNPRICEABLE';

const BILLING_UNAVAILABLE_MESSAGE = '计费服务暂不可用，请稍后重试';

export function toBillingChargeError(error: unknown): DomainError | NewApiError | null {
  if (!(error instanceof ConnectError)) return null;

  const reason = error.rawMessage.toUpperCase();

  if (error.code === Code.FailedPrecondition && reason.includes(REASON_INSUFFICIENT_CREDITS)) {
    return new DomainError(errorCodeToNumeric(ERROR_QUOTA_EXHAUSTED));
  }
  if (error.code === Code.InvalidArgument && reason.includes(REASON_UNPRICEABLE)) {
    return new DomainError(errorCodeToNumeric(ERROR_MODEL_UNAVAILABLE));
  }

  return toBillingError(error, BILLING_UNAVAILABLE_MESSAGE);
}
