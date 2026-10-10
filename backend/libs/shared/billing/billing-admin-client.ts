import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient, type Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { wallClockRfc3339 } from "@lib/core";
import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";
import {
  AdminConsumedCreditsRequestSchema,
  AdminGetActiveCatalogRequestSchema,
  AdminListTransactionsRequestSchema,
  AdminQueryUserStatsRequestSchema,
  BillingAdminService,
} from "../../contracts/gen/billing/v1/billing_pb.js";
import { BillingConfigError, billingEndpoint } from "./billing-client.js";

export const BILLING_ADMIN_URL_ENV = "BILLING_ADMIN_URL";

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


const adminClients = new Map<string, Client<typeof BillingAdminService>>();

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
  const params = new URLSearchParams({ publishedBy: input.publishedBy });
  if (input.note) params.set("note", input.note);

  const response = await send(`/admin/catalogs?${params.toString()}`, {
    method: "POST",
    body: input.document,
    env,
  });
  if (response.status === 400) {
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
  const path = "/admin/credits/grants";
  const init: RequestInit & { env: NodeJS.ProcessEnv } = {
    method: "POST",
    body: JSON.stringify({
      userId: input.userId,
      source: input.source ?? "purchased",
      amount: input.credits,
      bizId: input.bizId,
      bizType: input.bizType ?? "recharge",
      ...(input.grantKey ? { grantKey: input.grantKey } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt.toISOString() } : {}),
    }),
    env,
  };

  const response = await send(path, init);
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { existingBizId?: unknown } | null;
    return {
      lotId: "",
      duplicated: true,
      existingBizId: typeof body?.existingBizId === "string" ? body.existingBizId : null,
    };
  }
  if (!response.ok) {
    throw new BillingAdminError(`发放积分失败：billing 管理端返回 HTTP ${response.status}`);
  }
  const data = (await response.json()) as { lotId?: number | string };
  return { lotId: String(data.lotId ?? ""), duplicated: false, existingBizId: null };
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

const MEMBER_DISCOUNTS_PATH = "/admin/member-discounts";
const PROMOTIONS_PATH = "/admin/promotions";

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
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}


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
