import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';

export interface OperationLog {
  id: string;
  category: string;
  action: string;
  target: string;
  detail: string;
  operator: string;
  ipAddress?: string | null;
  createdAt: string;
}

export function fetchOperationLogs(
  params: { category?: string; searchText?: string; dateFrom?: string; dateTo?: string } = {}
) {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.searchText) qs.set('searchText', params.searchText);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  const query = qs.toString();
  return apiRequest<OperationLog[]>(`/api/admin/operation-logs${query ? `?${query}` : ''}`);
}

export interface CreateOperationLogParams {
  category: string;
  action: string;
  target?: string;
  targetUserId?: string;
  detail?: string;
  operator?: string;
  operatorId?: string;
  ipAddress?: string;
}

export function createOperationLog(params: CreateOperationLogParams) {
  return apiRequest<OperationLog>('/api/admin/operation-logs', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}


export const operationLogKeys = {
  all: ['admin-operation-logs'] as const,
  list: (params: Parameters<typeof fetchOperationLogs>[0]) =>
    [...operationLogKeys.all, 'list', params ?? {}] as const,
};

export function operationLogsOptions(params: Parameters<typeof fetchOperationLogs>[0] = {}) {
  return queryOptions({
    queryKey: operationLogKeys.list(params),
    queryFn: () => fetchOperationLogs(params),
  });
}
