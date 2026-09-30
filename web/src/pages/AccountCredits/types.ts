/** 账户积分与订单页的数据形状。接接口时保持这些字段，页面不用跟着改。 */

export interface CreditsLotPreview {
  remaining: number | null;
  expiresAt: string | null;
}

export interface CreditsSummary {
  balance: number | null;
  validityYears: number | null;
  nearestLot: CreditsLotPreview | null;
}

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'grant_failed';

export interface OrderRecord {
  id: string;
  orderedAt: string;
  productName: string;
  tradeNo: string;
  amountYuan: number | null;
  creditsGranted: number | null;
  status: OrderStatus;
}

export interface AcquiredRecord {
  id: string;
  acquiredAt: string;
  source: string;
  detail: string;
  effectiveAt: string | null;
  expiresAt: string | null;
  credits: number | null;
  remaining: number | null;
}

export type ConsumeKind = 'consume' | 'expire';

export interface ConsumedRecord {
  id: string;
  consumedAt: string;
  kind: ConsumeKind;
  taskType: string;
  model: string | null;
  detail: string | null;
  taskId: string | null;
  credits: number | null;
}

export interface RefundedRecord {
  id: string;
  refundedAt: string;
  taskType: string;
  model: string | null;
  detail: string | null;
  taskId: string | null;
  credits: number | null;
}

export interface AccountCreditsPageData {
  summary: CreditsSummary;
  orders: OrderRecord[];
  acquired: AcquiredRecord[];
  consumed: ConsumedRecord[];
  refunded: RefundedRecord[];
}
