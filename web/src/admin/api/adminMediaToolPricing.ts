import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';

export interface MediaToolPricing {
  id: string;
  tool_type: string;
  label: string;
  pricing: unknown;
  version: number;
  enabled: boolean;
  charge_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MediaToolPricingUpdate {
  label?: string;
  pricing?: Record<string, unknown>;
  enabled?: boolean;
  charge_enabled?: boolean;
}

export const mediaToolPricingKeys = {
  all: ['admin-media-tool-pricing'] as const,
  list: () => [...mediaToolPricingKeys.all, 'list'] as const,
};

export function fetchMediaToolPricing(): Promise<MediaToolPricing[]> {
  return apiRequest<MediaToolPricing[]>('/api/admin/media-tool-pricing', { silent: true });
}

export function mediaToolPricingOptions() {
  return queryOptions({
    queryKey: mediaToolPricingKeys.list(),
    queryFn: fetchMediaToolPricing,
  });
}

export function updateMediaToolPricing(
  toolType: string,
  input: MediaToolPricingUpdate,
): Promise<MediaToolPricing> {
  return apiRequest<MediaToolPricing>(
    `/api/admin/media-tool-pricing/${encodeURIComponent(toolType)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
      silent: true,
    },
  );
}
