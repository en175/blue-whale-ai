/* ============================================
 * 后台管理 API · 操作日志。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

/** 审计日志记录 */
export interface OperationLog {
  /** 日志ID（bigint string） */
  id: string;
  /** 日志类别：user 用户管理 / order 订单管理 */
  category: string;
  /** 操作动作：user.freeze / user.unfreeze / user.adjust_balance / order.complete */
  action: string;
  /** 操作目标：用户页 user:{userId}；订单页为交易号 */
  target: string;
  /** 操作详情 JSON 字符串，含 reason（用户管理另含 value） */
  detail: string;
  /** 操作人用户名 */
  operator: string;
  /** 操作人 IP；后端未写入时为 null */
  ipAddress?: string | null;
  /** 操作时间（ISO） */
  createdAt: string;
}

/** GET /api/admin/operation-logs 查询审计日志（用户页：category=user + searchText=user:{userId}） */
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

/** POST /api/admin/operation-logs 审计写入入参（由各模块 BFF 调用，操作日志页不直接调用） */
export interface CreateOperationLogParams {
  /** 日志类别：model.capability / tier / order / user / template */
  category: string;
  /** 操作动作，如 user.adjust_balance / order.complete */
  action: string;
  /** 操作目标：user:{userId} / 交易号 / 模型ID / 档位ID / 标签code */
  target?: string;
  /** 目标用户ID（正整数格式 ≤19 位），仅涉及用户操作时传入 */
  targetUserId?: string;
  /** 操作详情，通常为 JSON 字符串 */
  detail?: string;
  /** 操作人用户名 */
  operator?: string;
  /** 操作人用户ID（正整数格式 ≤19 位） */
  operatorId?: string;
  /** 操作人 IP */
  ipAddress?: string;
}

/** POST /api/admin/operation-logs 审计写入（管理操作成功后的审计记录）；操作日志页面不直接调用。实测响应为完整 camelCase 日志记录（文档示例 snake_case 与实际不符） */
export function createOperationLog(params: CreateOperationLogParams) {
  return apiRequest<OperationLog>('/api/admin/operation-logs', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// ---------- TanStack Query 工厂 ----------

/** ⚠️ `params` 整份进 key：它是服务端筛选（分类 / 关键词 / 时间范围），不是本地过滤。 */
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
