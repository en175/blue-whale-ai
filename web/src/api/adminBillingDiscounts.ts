import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface MemberDiscount {
  id: number;
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
  gmtCreate: string;
  gmtModified: string;
}

export interface MemberDiscountInput {
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
}

export const memberDiscountKeys = {
  all: ['admin-member-discounts'] as const,
  list: () => [...memberDiscountKeys.all, 'list'] as const,
};

export function fetchMemberDiscounts(): Promise<MemberDiscount[]> {
  return apiRequest<MemberDiscount[]>('/api/admin/billing-discounts', { silent: true });
}

export function createMemberDiscount(input: MemberDiscountInput): Promise<MemberDiscount> {
  return apiRequest<MemberDiscount>('/api/admin/billing-discounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateMemberDiscount(
  id: number,
  input: MemberDiscountInput,
): Promise<MemberDiscount> {
  return apiRequest<MemberDiscount>(`/api/admin/billing-discounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteMemberDiscount(id: number): Promise<unknown> {
  return apiRequest<unknown>(`/api/admin/billing-discounts/${id}`, { method: 'DELETE' });
}

export function memberDiscountsOptions() {
  return queryOptions({
    queryKey: memberDiscountKeys.list(),
    queryFn: fetchMemberDiscounts,
  });
}
