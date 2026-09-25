/* ============================================
 * 管理端 API：消费记录（`GET /api/admin/consumption-records`）
 *
 * ⚠️ 数据源是 **billing 的账本**（经 backend 的 BFF 转出），不是我们的库：
 *    钱只从 billing 的复式账本进出，本地任何一张表都只是它的投影。
 *
 * ⚠️ **游标分页、没有总数**。账本持续追加，要准确总数就得扫全表，而扫完那一刻它又变了。
 *    所以「上一页」必须由调用方自己维护游标栈（见页面的 usePagedCursors）。
 *    与充值记录的 offset 分页形状不同，但翻页控件是同一个组件，观感一致。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface AdminConsumptionRecord {
  /** 形如 `res:7` / `lot:12` / `led:expire:...`，三类来源全局唯一 */
  id: string;
  /** 归属用户。**管理面独有的列**——用户面契约里没有它 */
  user_id: number;
  type: string;
  /** in | out */
  direction: string;
  title: string;
  /** **整数积分**，该行唯一的金额：pending 时是预计消耗，done 时是实际消耗 */
  credits: number;
  /** pending | done */
  status: string;
  created_at: string;
  /** RFC3339；未结算为空串（**不是 null**，契约如此） */
  settled_at: string;
}

export interface AdminConsumptionRecordListData {
  items: AdminConsumptionRecord[];
  /** 空串 = 没有下一页 */
  next_page_token: string;
}

export interface AdminConsumptionRecordQuery {
  /** 空 = **全站消费** */
  userId?: string;
  /** 单值（consume | recharge | ...）；空 = 全部。多值会被 billing 拒成 400 */
  type?: string;
  pageSize: number;
  /** 上一页给的 next_page_token，原样回传；空 = 首页 */
  pageToken: string;
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
  if (query.userId) qs.set('userId', query.userId);
  if (query.type) qs.set('type', query.type);
  if (query.pageToken) qs.set('pageToken', query.pageToken);
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
