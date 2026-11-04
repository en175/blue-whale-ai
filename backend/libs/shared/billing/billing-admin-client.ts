import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { wallClockRfc3339 } from "@lib/core";
import {
  AdminConsumedCreditsRequestSchema,
  AdminDeleteMemberDiscountRequestSchema,
  AdminDeletePromotionRequestSchema,
  AdminGetActiveCatalogRequestSchema,
  AdminGrantRequestSchema,
  AdminListMemberDiscountsRequestSchema,
  AdminListPromotionsRequestSchema,
  AdminListTransactionsRequestSchema,
  AdminMemberDiscountInputSchema,
  AdminPromotionInputSchema,
  AdminPublishCatalogRequestSchema,
  AdminQueryUserStatsRequestSchema,
  AdminUpsertMemberDiscountRequestSchema,
  AdminUpsertPromotionRequestSchema,
  BillingAdminService,
  type AdminMemberDiscount,
  type AdminPromotion,
} from "../../contracts/gen/billing/v1/billing_pb.js";
import { BillingConfigError, billingEndpoint } from "./billing-client.js";

export class BillingAdminConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingAdminConfigError";
  }
}

export class BillingAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingAdminError";
  }
}

export class CatalogRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogRejectedError";
  }
}


const adminClients = new Map<string, Client<typeof BillingAdminService>>();

const ADMIN_CALL_OPTIONS = { timeoutMs: 10_000 } as const;

function adminClient(env: NodeJS.ProcessEnv): Client<typeof BillingAdminService> {
  const baseUrl = billingEndpoint(env);
  let client = adminClients.get(baseUrl);
  if (!client) {
    client = createClient(BillingAdminService, createGrpcTransport({ baseUrl }));
    adminClients.set(baseUrl, client);
  }
  return client;
}

function asAdminError(what: string, error: unknown): BillingAdminError | BillingAdminConfigError {
  if (error instanceof BillingConfigError) {
    return new BillingAdminConfigError(error.message);
  }
  if (error instanceof ConnectError) {
    const unavailable = error.code === Code.Unavailable || error.code === Code.DeadlineExceeded;
    return new BillingAdminError(
      `billing 管理端${what}失败：${unavailable ? "服务不可用" : error.code}`,
    );
  }
  return error instanceof Error ? error : new BillingAdminError(String(error));
}


export interface ActiveCatalog {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
  document: string;
}

export async function fetchActiveCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ActiveCatalog> {
  try {
    const active = await adminClient(env).adminGetActiveCatalog(
      create(AdminGetActiveCatalogRequestSchema, {}),
      ADMIN_CALL_OPTIONS,
    );
    return {
      catalogVersion: Number(active.version),
      documentHash: active.documentHash,
      creditsPerYuan: Number(active.creditsPerYuan),
      document: active.documentJson,
    };
  } catch (error) {
    throw asAdminError("读定价目录", error);
  }
}

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

export interface PublishCatalogResult {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
}

export interface PublishCatalogInput {
  document: string;
  publishedBy: string;
  note?: string;
}

export async function publishCatalog(
  input: PublishCatalogInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PublishCatalogResult> {
  try {
    const response = await adminClient(env).adminPublishCatalog(
      create(AdminPublishCatalogRequestSchema, {
        documentJson: input.document,
        publishedBy: input.publishedBy,
        note: input.note ?? "",
      }),
      ADMIN_CALL_OPTIONS,
    );
    return {
      catalogVersion: Number(response.catalogVersion),
      documentHash: response.documentHash,
      creditsPerYuan: Number(response.creditsPerYuan),
    };
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.InvalidArgument) {
      throw new CatalogRejectedError(`目录被拒：${error.rawMessage}`);
    }
    throw asAdminError("发布定价目录", error);
  }
}


export interface GrantCreditsInput {
  userId: number;
  credits: number;
  bizId: string;
  expiresAt?: Date;
  source?: string;
  bizType?: "recharge" | "grant" | "adjust";
  grantKey?: string;
}

export interface GrantCreditsResult {
  lotId: string;
  duplicated: boolean;
  existingBizId: string | null;
}

export async function grantCredits(
  input: GrantCreditsInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrantCreditsResult> {
  try {
    const response = await adminClient(env).adminGrant(
      create(AdminGrantRequestSchema, {
        userId: BigInt(input.userId),
        source: input.source ?? "purchased",
        amount: BigInt(input.credits),
        bizId: input.bizId,
        bizType: input.bizType ?? "recharge",
        grantKey: input.grantKey ?? "",
        expiresAt: input.expiresAt ? input.expiresAt.toISOString() : "",
      }),
      ADMIN_CALL_OPTIONS,
    );
    return {
      lotId: response.lotId === 0n ? "" : String(response.lotId),
      duplicated: response.duplicated,
      existingBizId: response.existingBizId === "" ? null : response.existingBizId,
    };
  } catch (error) {
    throw asAdminError("发放积分", error);
  }
}


export interface AdminTransactionItem {
  id: string;
  userId: number;
  type: string;
  direction: string;
  title: string;
  amount: number;
  reservedCredits: number | null;
  generationJobId: string | null;
  status: string;
  createdAt: string;
  settledAt: string;
}

export interface AdminTransactionPage {
  items: AdminTransactionItem[];
  total: number;
}

export interface AdminTransactionsQuery {
  userId?: number;
  type?: string;
  pageSize?: number;
  page?: number;
}

export async function listAdminTransactions(
  query: AdminTransactionsQuery = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AdminTransactionPage> {
  try {
    const page = await adminClient(env).adminListTransactions(
      create(AdminListTransactionsRequestSchema, {
        userId: BigInt(query.userId ?? 0),
        type: query.type ?? "",
        pageSize: query.pageSize ?? 0,
        page: query.page ?? 0,
      }),
      ADMIN_CALL_OPTIONS,
    );

    return {
      items: page.items.map((item) => ({
        id: item.id,
        userId: Number(item.userId),
        type: item.type,
        direction: item.direction,
        title: item.title,
        amount: Number(item.amount),
        reservedCredits: item.reservedCredits === undefined ? null : Number(item.reservedCredits),
        generationJobId:
          item.generationJobId === undefined ? null : String(item.generationJobId),
        status: item.status,
        createdAt: item.createdAt,
        settledAt: item.settledAt,
      })),
      total: Number(page.page?.total ?? 0),
    };
  } catch (error) {
    throw asAdminError("读流水", error);
  }
}


export async function fetchConsumedCredits(
  from: Date,
  to: Date,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    const response = await adminClient(env).adminConsumedCredits(
      create(AdminConsumedCreditsRequestSchema, {
        from: rfc3339(from),
        to: rfc3339(to),
      }),
      ADMIN_CALL_OPTIONS,
    );
    return Number(response.consumedCredits);
  } catch (error) {
    throw asAdminError("读消耗合计", error);
  }
}

export interface AdminUserStats {
  availableCredits: number;
  totalRecharged: number;
  totalConsumed: number;
}

export async function fetchAdminUserStats(
  userIds: number[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<number, AdminUserStats>> {
  if (userIds.length === 0) {
    return new Map();
  }
  try {
    const response = await adminClient(env).adminQueryUserStats(
      create(AdminQueryUserStatsRequestSchema, {
        userIds: userIds.map((id) => BigInt(id)),
      }),
      ADMIN_CALL_OPTIONS,
    );
    const result = new Map<number, AdminUserStats>();
    for (const [userId, stats] of Object.entries(response.stats)) {
      result.set(Number(userId), {
        availableCredits: Number(stats.availableCredits),
        totalRecharged: Number(stats.totalRecharged),
        totalConsumed: Number(stats.totalConsumed),
      });
    }
    return result;
  } catch (error) {
    throw asAdminError("读用户三列", error);
  }
}

function rfc3339(instant: Date): string {
  return wallClockRfc3339(instant);
}


export class DiscountRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountRejectedError";
  }
}

export class DiscountNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountNotFoundError";
  }
}

export interface BillingMemberDiscount {
  id: number;
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
  gmtCreate: string;
  gmtModified: string;
}

export interface MemberDiscountInput {
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
}

export interface BillingPromotion {
  id: number;
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  taskTypes: string[] | null;
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  daysOfWeek: number[] | null;
  status: string;
  priority: number;
  createdBy: string;
  gmtCreate: string;
  gmtModified: string;
}

export interface PromotionInput {
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  taskTypes: string[] | null;
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  daysOfWeek: number[] | null;
  status: string;
  priority: number;
}

export async function listMemberDiscounts(
  query: { tier?: string; status?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount[]> {
  try {
    const response = await adminClient(env).adminListMemberDiscounts(
      create(AdminListMemberDiscountsRequestSchema, {
        tier: query.tier ?? "",
        status: query.status ?? "",
      }),
      ADMIN_CALL_OPTIONS,
    );
    return response.items.map(toMemberDiscount);
  } catch (error) {
    throw discountError(error);
  }
}

export async function createMemberDiscount(
  input: MemberDiscountInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount> {
  return upsertMemberDiscount(0, input, env);
}

export async function updateMemberDiscount(
  id: number,
  input: MemberDiscountInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingMemberDiscount> {
  return upsertMemberDiscount(id, input, env);
}

async function upsertMemberDiscount(
  id: number,
  input: MemberDiscountInput,
  env: NodeJS.ProcessEnv,
): Promise<BillingMemberDiscount> {
  try {
    const response = await adminClient(env).adminUpsertMemberDiscount(
      create(AdminUpsertMemberDiscountRequestSchema, {
        id: BigInt(id),
        input: create(AdminMemberDiscountInputSchema, {
          tier: input.tier,
          modelPattern: input.modelPattern,
          taskPattern: input.taskPattern,
          discountBp: input.discountBp,
          priority: input.priority,
          status: input.status,
        }),
      }),
      ADMIN_CALL_OPTIONS,
    );
    if (response.discount === undefined) {
      throw new BillingAdminError("billing 返回的会员折扣为空");
    }
    return toMemberDiscount(response.discount);
  } catch (error) {
    throw discountError(error);
  }
}

export async function deleteMemberDiscount(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    await adminClient(env).adminDeleteMemberDiscount(
      create(AdminDeleteMemberDiscountRequestSchema, { id: BigInt(id) }),
      ADMIN_CALL_OPTIONS,
    );
  } catch (error) {
    throw discountError(error);
  }
}

export async function listPromotions(
  query: { status?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion[]> {
  try {
    const response = await adminClient(env).adminListPromotions(
      create(AdminListPromotionsRequestSchema, { status: query.status ?? "" }),
      ADMIN_CALL_OPTIONS,
    );
    return response.items.map(toPromotion);
  } catch (error) {
    throw discountError(error);
  }
}

export async function createPromotion(
  input: PromotionInput,
  operator: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion> {
  return upsertPromotion(0, input, operator, env);
}

export async function updatePromotion(
  id: number,
  input: PromotionInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BillingPromotion> {
  return upsertPromotion(id, input, "admin", env);
}

async function upsertPromotion(
  id: number,
  input: PromotionInput,
  operator: string,
  env: NodeJS.ProcessEnv,
): Promise<BillingPromotion> {
  try {
    const response = await adminClient(env).adminUpsertPromotion(
      create(AdminUpsertPromotionRequestSchema, {
        id: BigInt(id),
        operator,
        input: promotionInput(input),
      }),
      ADMIN_CALL_OPTIONS,
    );
    if (response.promotion === undefined) {
      throw new BillingAdminError("billing 返回的活动为空");
    }
    return toPromotion(response.promotion);
  } catch (error) {
    throw discountError(error);
  }
}

export async function deletePromotion(
  id: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  try {
    await adminClient(env).adminDeletePromotion(
      create(AdminDeletePromotionRequestSchema, { id: BigInt(id) }),
      ADMIN_CALL_OPTIONS,
    );
  } catch (error) {
    throw discountError(error);
  }
}

function promotionInput(input: PromotionInput) {
  return create(AdminPromotionInputSchema, {
    code: input.code,
    name: input.name,
    discountBp: input.discountBp,
    modelIds: input.modelIds,
    taskTypes: input.taskTypes ?? [],
    tierScope: input.tierScope ?? [],
    startAt: input.startAt,
    endAt: input.endAt,
    dailyTimeStart: input.dailyTimeStart ?? "",
    dailyTimeEnd: input.dailyTimeEnd ?? "",
    daysOfWeek: input.daysOfWeek ?? [],
    status: input.status,
    priority: input.priority,
  });
}

function toPromotion(promotion: AdminPromotion): BillingPromotion {
  return {
    id: Number(promotion.id),
    code: promotion.code,
    name: promotion.name,
    discountBp: promotion.discountBp,
    modelIds: promotion.modelIds,
    taskTypes: promotion.taskTypes.length === 0 ? null : promotion.taskTypes,
    tierScope: promotion.tierScope.length === 0 ? null : promotion.tierScope,
    startAt: promotion.startAt,
    endAt: promotion.endAt,
    dailyTimeStart: promotion.dailyTimeStart === "" ? null : promotion.dailyTimeStart,
    dailyTimeEnd: promotion.dailyTimeEnd === "" ? null : promotion.dailyTimeEnd,
    daysOfWeek: promotion.daysOfWeek.length === 0 ? null : promotion.daysOfWeek,
    status: promotion.status,
    priority: promotion.priority,
    createdBy: promotion.createdBy,
    gmtCreate: promotion.gmtCreate,
    gmtModified: promotion.gmtModified,
  };
}

function toMemberDiscount(discount: AdminMemberDiscount): BillingMemberDiscount {
  return {
    id: Number(discount.id),
    tier: discount.tier,
    modelPattern: discount.modelPattern,
    taskPattern: discount.taskPattern,
    discountBp: discount.discountBp,
    priority: discount.priority,
    status: discount.status,
    gmtCreate: discount.gmtCreate,
    gmtModified: discount.gmtModified,
  };
}

function discountError(
  error: unknown,
): BillingAdminError | BillingAdminConfigError | DiscountNotFoundError | DiscountRejectedError {
  if (error instanceof ConnectError) {
    if (error.code === Code.InvalidArgument) {
      return new DiscountRejectedError(`折扣配置被拒：${error.rawMessage}`);
    }
    if (error.code === Code.NotFound) {
      return new DiscountNotFoundError(`目标不存在：${error.rawMessage}`);
    }
  }
  return asAdminError("管理折扣配置", error);
}
