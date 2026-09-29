/* ============================================
 * 管理端 API：充值记录（`GET /api/admin/recharge-records`）
 *
 * 数据源是我们自己的 `recharge_orders`（本地表），所以是 **offset 分页 + 有总数**。
 * 与积分记录（读 billing 账本、游标分页、无总数）形状不同，但两者用同一个
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
  /**
   * 本单**挂着**的首购加赠额度（下单时的配置快照）；0 = 这单没有赠送。
   *
   * <p>⚠️ 它是「挂着多少」，**不是「发了多少」**——「到底发没发」看
   * {@link firstPurchaseState}。只看本列会把「用户已经用过了」误读成「发了」。
   */
  bonusCredits: number;
  /** 该档位是否参与首购加赠（配置快照，0/1）。与 state 分开：一个说商品，一个说结果 */
  firstPurchaseEligible: number;
  /**
   * 首购判定结果：`unknown` 未判定 | `first` 本单是该档位首次、赠送已发 |
   * `repeat` 该档位已用过赠送（赠送被**别的**单拿走了）。
   *
   * <p>`unknown` 也包含「撞了幂等键但拿不到归属」——那时宁可不下结论，也不猜。
   */
  firstPurchaseState: string;
  creditsPerYuan: number;
  status: AdminRechargeStatus;
  paidAt: string | null;
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

/** 人工补发的结果：补发**之后**回读到的真实状态（服务端说的，不是前端猜的）。 */
export interface AdminRechargeRetryResult {
  tradeNo: string;
  status: AdminRechargeStatus;
}

/**
 * 人工补发一笔卡住的单（`POST /api/admin/recharge-records/:tradeNo/retry-grant`）。
 *
 * ⚠️ **为什么要这个按钮**：一笔「钱收了、积分始终发不出去」的单，在自动重试窗口（2 小时）
 * 用尽之后就再没有任何自动路径会碰它 —— 网关只重投约 15 分钟、用户轮询要用户开着页面、
 * 扫描器超窗就停。没有「放弃」这个状态，也没有别的入口：运营只能看着它卡在那里。
 * 这个按钮就是那条出口（E-1）。
 *
 * ⚠️ 它**故意越过重试窗口**：窗口约束的是无人看管时的重试预算，而这一下是有人明确点的。
 * 服务端侧重复调用是安全的（发放走 billing 的幂等键），所以点错行不会多发积分。
 */
export function retryAdminRechargeGrant(
  tradeNo: string,
): Promise<AdminRechargeRetryResult> {
  return apiRequest<AdminRechargeRetryResult>(
    `/api/admin/recharge-records/${encodeURIComponent(tradeNo)}/retry-grant`,
    { method: 'POST', silent: true },
  );
}
