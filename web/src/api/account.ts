/* ============================================
 * account 接口：充值记录/消费记录，对接真实后端
 * ============================================ */
import { apiRequest } from './http';

/** 充值记录项（GET /api/account/topups；credits 为积分，created_at 为秒时间戳） */
export interface TopUpRecord {
  trade_no: string;
  credits: number;
  amount_cny: number;
  payment_method: string;
  status: string;
  created_at: number;
}

/** 消费记录项（GET /api/account/consumptions；credits 为积分，created_at 为秒时间戳） */
export interface ConsumptionRecord {
  id: number;
  /** 账单方向：consume 扣费 / refund 退回。展示端据此定符号与图标，别按 credits 正负猜——
   *  后端给的一律是**正的变动幅度**（IKGCWU）。 */
  kind: 'consume' | 'refund';
  credits: number;
  summary: string;
  /** 原模型名（后端 `toAccountConsumptionItem.model`） */
  model: string;
  created_at: number;
}

/** 充值记录分页（后端参数 p/page_size，见 backend/libs/shared/account/records.ts） */
export function fetchTopups(page = 1, pageSize = 20) {
  return apiRequest<{ items: TopUpRecord[]; total: number }>(
    `/api/account/topups?p=${page}&page_size=${pageSize}`,
  );
}

/** 消费记录分页 */
export function fetchConsumptions(page = 1, pageSize = 20) {
  return apiRequest<{ items: ConsumptionRecord[]; total: number }>(
    `/api/account/consumptions?p=${page}&page_size=${pageSize}`,
  );
}
