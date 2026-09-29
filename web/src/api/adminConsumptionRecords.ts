/* ============================================
 * 管理端 API：积分记录（`GET /api/admin/consumption-records`）
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
  /**
   * 该行**当初冻了多少**（整数积分）。**只有消费行有值**，发放行与账本行为「没有」。
   *
   * ⚠️ 「没有」在线上有**两种**形态，缺一不可判：
   *    - `null` —— 后端按契约显式回的（BFF 那句 `?? null` 就是为此）
   *    - **键根本不存在** —— 后端是**比前端旧的构建**时就是这样：老版本压根没投影这一列。
   *      前端先上、后端后上（或回滚）就会出现，实测 2026-09-26 撞过一次，整页白屏。
   *
   * ⚠️ 所以判空只能写 `== null`（**不要**写 `=== null`，更不要写 `if (reserved)`）：
   *    - `=== null` 漏掉 `undefined` ⇒ 把一个「没有」当成「有值」渲染 ⇒ `.toLocaleString()` 崩
   *    - 真值判断会把 `0` 当成「没有预扣」而不显示，恰好漏掉「全额退回」那一行
   *
   * 为什么要有它：done 之后 `credits` 已经是实际值，「当初冻了多少」就只剩这里能读。
   * 用户余额先降后回的差额靠它解释（实测某任务冻 12、实扣 1，流水上只有一行 -1）。
   * 未结算行（pending）的 `credits` 本就是预扣额，两个数相同。
   */
  reserved_credits?: number | null;
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
