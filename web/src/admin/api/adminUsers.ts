import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';
import { useAuthStore } from '@/shared/stores/auth';
import { type UserManageAction } from '@/admin/enums';

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


export const BUILTIN_ROLES = [
  { code: 'user', label: '普通用户', hint: '可使用产品，无管理端权限' },
  { code: 'admin', label: '管理员', hint: '可访问管理端' },
  { code: 'super_admin', label: '超级管理员（Root）', hint: '可管理他人角色' },
] as const;

export function fetchUserRoles(userId: number) {
  return apiRequest<{ roles: string[] }>(`/api/admin/users/${userId}/roles`, { silent: true });
}

export function grantUserRole(userId: number, code: string) {
  return apiRequest<{ roles: string[] }>(`/api/admin/users/${userId}/roles`, {
    method: 'POST',
    body: JSON.stringify({ code }),
    silent: true,
  });
}

export function revokeUserRole(userId: number, code: string) {
  return apiRequest<{ roles: string[] }>(`/api/admin/users/${userId}/roles/${code}`, {
    method: 'DELETE',
    silent: true,
  });
}

export const adminUserKeys = {
  all: ['admin-users'] as const,
  list: (params: Parameters<typeof fetchAdminUsers>[0]) =>
    [...adminUserKeys.all, 'list', params ?? {}] as const,
  roles: (userId: number) => [...adminUserKeys.all, 'roles', userId] as const,
};

export function adminUsersOptions(params: Parameters<typeof fetchAdminUsers>[0] = {}) {
  return queryOptions({
    queryKey: adminUserKeys.list(params),
    queryFn: () => fetchAdminUsers(params),
  });
}

export function userRolesOptions(userId: number) {
  return queryOptions({
    queryKey: adminUserKeys.roles(userId),
    queryFn: () => fetchUserRoles(userId),
  });
}
