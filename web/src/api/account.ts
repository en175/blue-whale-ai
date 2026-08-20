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
  credits: number;
  summary: string;
  created_at: number;
}

/** 充值记录分页 */
export function fetchTopups(page = 1, pageSize = 20) {
  return apiRequest<{ items: TopUpRecord[]; total: number }>(
    `/api/account/topups?page=${page}&pageSize=${pageSize}`,
  );
}

/** 消费记录分页 */
export function fetchConsumptions(page = 1, pageSize = 20) {
  return apiRequest<{ items: ConsumptionRecord[]; total: number }>(
    `/api/account/consumptions?page=${page}&pageSize=${pageSize}`,
  );
}
