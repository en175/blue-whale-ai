import { queryOptions } from '@tanstack/react-query';
import { http, apiRequestWithMeta } from '@/api/http';

export type TopupTierStatus = 'draft' | 'active' | 'inactive';

export type TopupTierPermission = 'all' | 'user_group' | 'member_tier';

export interface TopupTier {
  id: string;
  name: string;
  baseCredits: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: TopupTierStatus;
  startTime: string | null;
  endTime: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  description: string;
  bonusCredits: number;
  activityTag: string;
  buttonText: string;
  firstPurchaseEligible: boolean;
  creditsValidMonths: number;
  permission: TopupTierPermission;
  permissionAllowlist: string[];
  permissionDeniedHint: string;
}

export interface TopupTierList {
  tiers: TopupTier[];
}

export function fetchTopupTiers() {
  return http.get<TopupTierList>('/api/admin/topup-tiers');
}

export interface CreateTopupTierParams {
  originalPrice: number;
  discount: number;
  baseCredits: number;
  name?: string;
  isRecommended?: boolean;
  status?: TopupTierStatus;
  startTime?: string;
  endTime?: string;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
}

export interface UpdateTopupTierParams {
  originalPrice?: number;
  discount?: number;
  baseCredits?: number;
  name?: string;
  isRecommended?: boolean;
  status?: TopupTierStatus;
  startTime?: string;
  endTime?: string;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
}

export function createTopupTier(params: CreateTopupTierParams) {
  return apiRequestWithMeta<TopupTier>('/api/admin/topup-tiers', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function updateTopupTier(id: string, params: UpdateTopupTierParams) {
  return apiRequestWithMeta<TopupTier>(`/api/admin/topup-tiers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export function deleteTopupTier(id: string) {
  return apiRequestWithMeta<null>(`/api/admin/topup-tiers/${id}`, {
    method: 'DELETE',
  });
}

export interface SortTopupTierItem {
  id: string;
  sortOrder: number;
}

export interface SortTopupTierResult {
  id: string;
  sortOrder: number;
  baseCredits: number;
  originalPrice: number;
  price: number;
  status: TopupTierStatus;
}

export function sortTopupTiers(items: SortTopupTierItem[]) {
  return apiRequestWithMeta<SortTopupTierResult[]>('/api/admin/topup-tiers/sort', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

export interface TopupTierPreview {
  id: string;
  baseCredits: number;
  originalPrice: number;
  discount: number;
  price: number;
  isRecommended: boolean;
  status: TopupTierStatus;
}

export function fetchTopupTierPreview() {
  return http.get<TopupTierPreview[]>('/api/admin/topup-tiers/preview');
}

export interface SyncTiersData {
  synced: number;
  total: number;
}

export function syncTopupTiersToGo() {
  return apiRequestWithMeta<SyncTiersData>('/api/admin/topup-tiers/sync', {
    method: 'PUT',
  });
}


export const topupTierKeys = {
  all: ['admin-topup-tiers'] as const,
  list: () => [...topupTierKeys.all, 'list'] as const,
};

export function topupTiersOptions() {
  return queryOptions({
    queryKey: topupTierKeys.list(),
    queryFn: () => fetchTopupTiers(),
  });
}

export const topupTierPreviewKeys = {
  all: ['admin-topup-tier-preview'] as const,
};

export function topupTierPreviewOptions() {
  return queryOptions({
    queryKey: topupTierPreviewKeys.all,
    queryFn: () => fetchTopupTierPreview(),
  });
}
