import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/api/http';

export interface BillingCatalog {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
  document: string;
}

export interface PublishBillingCatalogInput {
  document: string;
  note?: string;
}

export interface PublishBillingCatalogResult {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
}

export const billingCatalogKeys = {
  all: ['admin-billing-catalog'] as const,
  active: () => [...billingCatalogKeys.all, 'active'] as const,
};

export function fetchBillingCatalog(): Promise<BillingCatalog> {
  return apiRequest<BillingCatalog>('/api/admin/billing-catalog', { silent: true });
}

export function publishBillingCatalog(
  input: PublishBillingCatalogInput,
): Promise<PublishBillingCatalogResult> {
  return apiRequest<PublishBillingCatalogResult>('/api/admin/billing-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function billingCatalogOptions() {
  return queryOptions({
    queryKey: billingCatalogKeys.active(),
    queryFn: fetchBillingCatalog,
  });
}
