import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';

export type AdminRechargeStatus =
  | 'pending'
  | 'paid_pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'grant_failed';

export interface AdminRechargeRecord {
  tradeNo: string;
  payOrderId: string | null;
  userId: string;
  nickname?: string | null;
  phone?: string | null;
  tierId: string | null;
  productType: string;
  productName: string;
  amountFen: number;
  credits: number;
  bonusCredits: number;
  firstPurchaseEligible: number;
  firstPurchaseState: string;
  creditsPerYuan: number;
  status: AdminRechargeStatus;
  paidAt: string | null;
  notifyCount: number;
  createdAt: string;
}

export interface AdminRechargeRecordListData {
  list: AdminRechargeRecord[];
  total: number;
}

export interface AdminRechargeRecordQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: AdminRechargeStatus;
  tradeNo?: string;
}

export const adminRechargeRecordKeys = {
  all: ['admin-recharge-records'] as const,
  list: (query: AdminRechargeRecordQuery) =>
    [...adminRechargeRecordKeys.all, query] as const,
};

export function fetchAdminRechargeRecords(
  query: AdminRechargeRecordQuery,
): Promise<AdminRechargeRecordListData> {
  const qs = new URLSearchParams();
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.status) qs.set('status', query.status);
  if (query.tradeNo) qs.set('tradeNo', query.tradeNo);
  return apiRequest<AdminRechargeRecordListData>(
    `/api/admin/recharge-records?${qs.toString()}`,
    { silent: true },
  );
}

export function adminRechargeRecordsOptions(query: AdminRechargeRecordQuery) {
  return queryOptions({
    queryKey: adminRechargeRecordKeys.list(query),
    queryFn: () => fetchAdminRechargeRecords(query),
  });
}

export interface AdminRechargeRetryResult {
  tradeNo: string;
  status: AdminRechargeStatus;
}

export function retryAdminRechargeGrant(
  tradeNo: string,
): Promise<AdminRechargeRetryResult> {
  return apiRequest<AdminRechargeRetryResult>(
    `/api/admin/recharge-records/${encodeURIComponent(tradeNo)}/retry-grant`,
    { method: 'POST', silent: true },
  );
}
