/* ============================================
 * 管理端 API：任务记录（`GET /api/admin/job-records`）
 *
 * 数据源是我们自己的 `generation_jobs`（本地表），offset 分页 + 有总数。
 *
 * ⚠️ 这一页**不是账单**：任务 ≠ 消费。任务可能失败全额返还（用户净变化 0，
 *    账本里不会出现一行消费），也可能一个任务对应多次扣费。要看钱去消费记录页。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface AdminJobRecord {
  job_id: string;
  /** 归属用户（bigint 字符串，超出 JS 安全整数范围也不丢精度） */
  user_id: string;
  /** 画布项目 id；不在项目里的任务为空串 */
  project_id: string;
  /** 任务类型（text2video / audio_mix / …）。自由文本——后端不写死白名单，新类型不会被误伤 */
  type: string;
  /** queued | running | succeeded | failed | … */
  status: string;
  /** 0–100 */
  progress: number;
  /** 实际调用的上游厂商；未派发为 null */
  provider: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  /** 失败原因（与用户在任务详情里看到的是同一份文案）；未失败为 null */
  error: { code: number; message: string } | null;
}

export interface AdminJobRecordListData {
  list: AdminJobRecord[];
  total: number;
}

export interface AdminJobRecordQuery {
  page: number;
  pageSize: number;
  /** 空 = 全部用户 */
  userId?: string;
  projectId?: string;
  /** 空 = 全部类型 */
  type?: string;
  /** 空 = 全部状态 */
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
  if (query.userId) qs.set('userId', query.userId);
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
