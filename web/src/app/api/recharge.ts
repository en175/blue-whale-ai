import { apiRequest } from '@/shared/api/http';

export interface RechargeTier {
  id: string;
  name: string;
  amount: number;
  price: number;
  original_price: number | null;
  discount: number;
  is_recommended: boolean;
  sort_order: number;
  can_purchase: boolean | null;
  denied_hint: string;
  credits_valid_months: number;
}

export interface RechargeTierCatalog {
  tiers: RechargeTier[];
  credits_per_yuan: number;
}

export interface RechargeCustomConfig {
  enabled: boolean;
  min_credits: number;
  max_credits: number;
  default_credits: number;
  step_credits: number;
  credits_per_yuan: number;
  credits_valid_months: number;
  can_purchase: boolean | null;
  denied_hint: string;
}

export interface RechargeOrder {
  trade_no: string;
  qr_code_url: string;
  expire_time: string;
  amount: number;
  points: number;
}

export type RechargeOrderState =
  | 'pending'
  | 'paid_pending'
  | 'paid'
  | 'expired'
  | 'failed'
  | 'grant_failed';

export interface RechargeOrderStatus {
  trade_no: string;
  status: RechargeOrderState;
  credits_after: number | null;
}

export function fetchRechargeTierCatalog() {
  return apiRequest<RechargeTierCatalog>('/api/recharge/tiers', { silent: true });
}

export function createRechargeOrder(tierId: string) {
  return apiRequest<RechargeOrder>('/api/recharge/order', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ tier_id: tierId }),
  });
}

export function fetchRechargeCustomConfig() {
  return apiRequest<RechargeCustomConfig>('/api/recharge/custom', { silent: true });
}

export function createCustomRechargeOrder(credits: number) {
  return apiRequest<RechargeOrder>('/api/recharge/order', {
    method: 'POST',
    silent: true,
    body: JSON.stringify({ credits }),
  });
}

export function fetchRechargeOrderStatus(tradeNo: string) {
  return apiRequest<RechargeOrderStatus>(
    `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
    { silent: true },
  );
}
