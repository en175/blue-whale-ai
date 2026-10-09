import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';
import { useAuthStore } from '@/stores/auth';

export interface AdminUserRow {
  userId: number;
  nickname: string;
  phone: string;
  balance: number;
  totalRecharge: number;
  totalSpend: number;
  role: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListData {
  list: AdminUserRow[];
  total: number;
}

export function fetchAdminUsers(
  params: { keyword?: string; status?: string; page?: number; pageSize?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.status) qs.set('status', params.status);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  const adminUserId = useAuthStore.getState().user?.userId;
  return apiRequest<AdminUserListData>(`/api/admin/users?${qs.toString()}`, {
    method: 'GET',
    headers: adminUserId !== undefined ? { 'New-Api-User': String(adminUserId) } : {},
  });
}

export type UserManageAction = 'freeze' | 'unfreeze' | 'adjustBalance';

export interface AdjustBalanceResult {
  credits: number | null;
  duplicated: boolean;
}

export function manageAdminUser(
  userId: number,
  params: {
    action: UserManageAction;
    reason: string;
    value?: number;
    idempotencyKey?: string;
  }
) {
  const { idempotencyKey, ...body } = params;
  return apiRequest<AdjustBalanceResult | { revokedSessions: number } | null>(
    `/api/admin/users/${userId}/manage`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
    }
  );
}


export const adminUserKeys = {
  all: ['admin-users'] as const,
  list: (params: Parameters<typeof fetchAdminUsers>[0]) =>
    [...adminUserKeys.all, 'list', params ?? {}] as const,
};

export function adminUsersOptions(params: Parameters<typeof fetchAdminUsers>[0] = {}) {
  return queryOptions({
    queryKey: adminUserKeys.list(params),
    queryFn: () => fetchAdminUsers(params),
  });
}
