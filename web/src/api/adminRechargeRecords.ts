/* ============================================
 * 管理端 API：充值记录（`GET /api/admin/recharge-records`）
 *
 * 数据源是我们自己的 `recharge_orders`（本地表），所以是 **offset 分页 + 有总数**。
 * 与消费记录（读 billing 账本、游标分页、无总数）形状不同，但两者用同一个
 * `Pagination` 组件，翻页观感一致。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

/**
 * 与后端 `RechargeOrderStatus` **逐字一致**（后端的白名单会拒绝其它值）。
 *
 * ⚠️ 2026-09-26 由 4 态扩到 6 态，多出来的两个不是补漏而是**新语义**：
 *   · `paid_pending` —— **钱收到了、积分还没发出去**（发放失败时订单停在这里）；
 *   · `grant_failed` —— 发放反复失败，需人工介入（由对账任务写入）。
 * 判「钱到没到」的口径是 **`paid_pending` 或 `paid`**（后端 `PAID_REACHED_STATUSES`），
 * 不再是 `= paid`。少写一种状态不会报错，只会让那类单在筛选与列表里静默消失。
 */
export type AdminRechargeStatus =
  | 'pending'
  | 'paid_pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'grant_failed';

export interface AdminRechargeRecord {
  /** 交易单号（我们生成的，也是 billing 那边发放积分的幂等键来源） */
  tradeNo: string;
  /** 支付网关订单号；下单应答回来前为 null */
  payOrderId: string | null;
  /** 用户 ID（bigint 字符串，超出 JS 安全整数范围也不丢精度） */
  userId: string;
  /**
   * 档位 ID；**自定义充值（模块 B）为 null** —— 它没有档位。
   *
   * ⚠️ 判「是不是档位商品」看 `productType`，不看这一列：列的 null 只说明「这单没有档位」。
   */
  tierId: string | null;
  /** 商品类型快照：`tier` 固定积分卡 | `custom` 自定义充值（判类型看它，不看 tierId） */
  productType: string;
  /** 商品名称快照（如「轻量尝鲜」「自定义充值」）—— 自定义充值单在列表里靠它认出来 */
  productName: string;
  /** 实付金额，单位**分**——不是元，也不是积分 */
  amountFen: number;
  /** 下单时冻结的到账积分（按档位原价 × 当时的换算率算定，之后改口径不追溯） */
  credits: number;
  creditsPerYuan: number;
  status: AdminRechargeStatus;
  paidAt: string | null;
  /** billing 的发放批次 id；未到账为 null */
  grantLotId: string | null;
  /** 网关回调到达次数（只做可观测，不参与到账判定） */
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
  /** 按用户过滤；空 = 全部用户 */
  userId?: string;
  /** 空 = 全部状态 */
  status?: AdminRechargeStatus;
  /** 交易单号**精确**匹配（后端也是精确的） */
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
  if (query.userId) qs.set('userId', query.userId);
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
