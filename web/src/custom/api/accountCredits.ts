import { queryOptions } from '@tanstack/react-query';
import { ApiError, API_PREFIX, apiRequest, readApiErrorMessage } from '@/shared/api/http';
import { getSessionToken } from '@/shared/api/sessionToken';
import type { UsageTokenData } from '@/shared/stores/auth';
import { type ExportScope, type OrderStatus, SOURCE_LABELS } from '@/custom/enums';

export type { UsageTokenData, UsageTokenLot } from '@/shared/stores/auth';

export interface OrderRow {
  trade_no: string;
  product_name: string;
  product_type: string;
  amount_fen: number;
  credits: number;
  bonus_credits: number;
  status: OrderStatus;
  created_at: string;
  paid_at: string | null;
  credits_valid_months: number | null;
}

export interface CreditLotRow {
  lot_id: string;
  source: string;
  amount: number;
  remaining: number;
  created_at: string;
  expires_at: string;
  detail: string;
}

export interface ConsumptionRow {
  id: string;
  type: string;
  direction: 'in' | 'out';
  title: string;
  credits: number;
  status: 'pending' | 'done';
  created_at: string;
  settled_at: string;
  job_id: string | null;
  task_type: string | null;
  model_id: string | null;
  model_label: string | null;
  prompt: string | null;
  detail: string | null;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface OrdersQuery extends PageQuery {
  status?: string;
}

export interface ConsumptionsQuery extends PageQuery {
  type?: string;
}

interface PageData<T> {
  items: T[];
  total: number;
}

function pageParams(q: PageQuery): URLSearchParams {
  return new URLSearchParams({ page: String(q.page), page_size: String(q.pageSize) });
}

export function fetchUsageToken() {
  return apiRequest<UsageTokenData>('/api/usage/token', { silent: true });
}

export function fetchOrders(q: OrdersQuery) {
  const qs = pageParams(q);
  if (q.status) qs.set('status', q.status);
  return apiRequest<PageData<OrderRow>>(`/api/account/orders?${qs.toString()}`, { silent: true });
}

export function fetchCreditLots(q: PageQuery) {
  return apiRequest<PageData<CreditLotRow>>(
    `/api/account/credit-lots?${pageParams(q).toString()}`,
    { silent: true },
  );
}

export function fetchAccountConsumptions(q: ConsumptionsQuery) {
  const qs = pageParams(q);
  if (q.type) qs.set('type', q.type);
  return apiRequest<PageData<ConsumptionRow>>(
    `/api/account/consumptions?${qs.toString()}`,
    { silent: true },
  );
}

export interface ExportQuery {
  scope: ExportScope;
  fields: string[];
  status?: string;
  type?: string;
}

export async function fetchAccountExport(q: ExportQuery): Promise<Blob> {
  const qs = new URLSearchParams({ scope: q.scope, fields: q.fields.join(',') });
  if (q.status) qs.set('status', q.status);
  if (q.type) qs.set('type', q.type);

  const headers = new Headers();
  const token = getSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_PREFIX}/account/export?${qs.toString()}`, { headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => undefined)) as { msg?: string } | undefined;
    throw new ApiError(res.status, readApiErrorMessage(body, res.status), body?.msg ?? res.status);
  }
  return res.blob();
}

export const accountCreditsKeys = {
  token: () => ['account-credits', 'token'] as const,
  orders: (q: OrdersQuery) => ['account-credits', 'orders', q] as const,
  lots: (q: PageQuery) => ['account-credits', 'lots', q] as const,
  consumptions: (q: ConsumptionsQuery) => ['account-credits', 'consumptions', q] as const,
};

export function usageTokenOptions() {
  return queryOptions({ queryKey: accountCreditsKeys.token(), queryFn: fetchUsageToken });
}

export function ordersOptions(q: OrdersQuery) {
  return queryOptions({ queryKey: accountCreditsKeys.orders(q), queryFn: () => fetchOrders(q) });
}

export function creditLotsOptions(q: PageQuery) {
  return queryOptions({ queryKey: accountCreditsKeys.lots(q), queryFn: () => fetchCreditLots(q) });
}

export function accountConsumptionsOptions(q: ConsumptionsQuery) {
  return queryOptions({
    queryKey: accountCreditsKeys.consumptions(q),
    queryFn: () => fetchAccountConsumptions(q),
  });
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
