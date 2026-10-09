import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface AdminJobRecord {
  job_id: string;
  user_id: string;
  nickname?: string | null;
  phone?: string | null;
  project_id: string;
  type: string;
  status: string;
  progress: number;
  model_id: string | null;
  model_label: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  error: { code: number; message: string } | null;
}

export interface AdminJobRecordListData {
  list: AdminJobRecord[];
  total: number;
}

export interface AdminJobRecordQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  projectId?: string;
  type?: string;
  status?: string;
}

export const adminJobRecordKeys = {
  all: ['admin-job-records'] as const,
  list: (query: AdminJobRecordQuery) => [...adminJobRecordKeys.all, query] as const,
};

export function fetchAdminJobRecords(
  query: AdminJobRecordQuery,
): Promise<AdminJobRecordListData> {
  const qs = new URLSearchParams();
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.projectId) qs.set('projectId', query.projectId);
  if (query.type) qs.set('type', query.type);
  if (query.status) qs.set('status', query.status);
  return apiRequest<AdminJobRecordListData>(`/api/admin/job-records?${qs.toString()}`, {
    silent: true,
  });
}

export function adminJobRecordsOptions(query: AdminJobRecordQuery) {
  return queryOptions({
    queryKey: adminJobRecordKeys.list(query),
    queryFn: () => fetchAdminJobRecords(query),
  });
}
