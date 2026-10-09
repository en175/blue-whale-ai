import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface Promotion {
  id: number;
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  taskTypes: string[] | null;
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  daysOfWeek: number[] | null;
  tz: string;
  status: string;
  priority: number;
  createdBy: string;
  gmtCreate: string;
  gmtModified: string;
}

export interface PromotionInput {
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  taskTypes: string[] | null;
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  daysOfWeek: number[] | null;
  tz: string;
  status: string;
  priority: number;
}

export const promotionKeys = {
  all: ['admin-billing-promotions'] as const,
  list: () => [...promotionKeys.all, 'list'] as const,
};

export function fetchPromotions(): Promise<Promotion[]> {
  return apiRequest<Promotion[]>('/api/admin/billing-promotions', { silent: true });
}

export function createPromotion(input: PromotionInput): Promise<Promotion> {
  return apiRequest<Promotion>('/api/admin/billing-promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updatePromotion(id: number, input: PromotionInput): Promise<Promotion> {
  return apiRequest<Promotion>(`/api/admin/billing-promotions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deletePromotion(id: number): Promise<unknown> {
  return apiRequest<unknown>(`/api/admin/billing-promotions/${id}`, { method: 'DELETE' });
}

export function promotionsOptions() {
  return queryOptions({
    queryKey: promotionKeys.list(),
    queryFn: fetchPromotions,
  });
}
