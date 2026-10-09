import { apiRequest } from './http';

export interface ConsumptionRecord {
  id: string;
  type: string;
  direction: 'in' | 'out';
  title: string;
  credits: number;
  status: 'pending' | 'done';
  created_at: string;
  settled_at: string;
}

export function fetchConsumptions(page = 1, pageSize = 20, type?: string) {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (type) qs.set('type', type);
  return apiRequest<{ items: ConsumptionRecord[]; total: number }>(
    `/api/account/consumptions?${qs.toString()}`,
  );
}
