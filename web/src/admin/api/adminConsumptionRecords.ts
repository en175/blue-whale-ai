import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';

export interface AdminConsumptionRecord {
  id: string;
  user_id: number;
  nickname?: string | null;
  phone?: string | null;
  type: string;
  direction: string;
  title: string;
  credits: number;
  reserved_credits?: number | null;
  task_type?: string | null;
  model_id?: string | null;
  model_label?: string | null;
  prompt?: string | null;
  status: string;
  created_at: string;
  settled_at: string;
}

export interface AdminConsumptionRecordListData {
  items: AdminConsumptionRecord[];
  total: number;
}

export interface AdminConsumptionRecordQuery {
  keyword?: string;
  type?: string;
  pageSize: number;
  page: number;
}

export const adminConsumptionRecordKeys = {
  all: ['admin-consumption-records'] as const,
  list: (query: AdminConsumptionRecordQuery) =>
    [...adminConsumptionRecordKeys.all, query] as const,
};

export function fetchAdminConsumptionRecords(
  query: AdminConsumptionRecordQuery,
): Promise<AdminConsumptionRecordListData> {
  const qs = new URLSearchParams();
  qs.set('pageSize', String(query.pageSize));
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.type) qs.set('type', query.type);
  qs.set('page', String(query.page));
  return apiRequest<AdminConsumptionRecordListData>(
    `/api/admin/consumption-records?${qs.toString()}`,
    { silent: true },
  );
}

export function adminConsumptionRecordsOptions(query: AdminConsumptionRecordQuery) {
  return queryOptions({
    queryKey: adminConsumptionRecordKeys.list(query),
    queryFn: () => fetchAdminConsumptionRecords(query),
  });
}
