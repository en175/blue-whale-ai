import { queryOptions } from '@tanstack/react-query';
import { apiRequestWithMeta } from '@/api/http';
import type { TopupTierPermission } from './admin';

export interface AdminRechargeCustomConfig {
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  creditsPerYuan: number;
  stepCredits: number;
  enabled: boolean;
  permission: TopupTierPermission;
  permissionAllowlist: string[];
  permissionDeniedHint: string;
  creditsValidMonths: number;
  version: number;
  updatedAt: string;
  permissionLabel?: string;
}

export interface SaveRechargeCustomConfigParams {
  minCredits?: number;
  maxCredits?: number;
  defaultCredits?: number;
  creditsPerYuan?: number;
  stepCredits?: number;
  enabled?: boolean;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
  creditsValidMonths?: number;
}

export function fetchAdminRechargeCustomConfig() {
  return apiRequestWithMeta<AdminRechargeCustomConfig>('/api/admin/recharge-custom-config');
}

export const adminRechargeCustomConfigKeys = {
  all: ['admin-recharge-custom-config'] as const,
};

export function adminRechargeCustomConfigOptions() {
  return queryOptions({
    queryKey: adminRechargeCustomConfigKeys.all,
    queryFn: async () => (await fetchAdminRechargeCustomConfig()).data,
  });
}

export function saveAdminRechargeCustomConfig(params: SaveRechargeCustomConfigParams) {
  return apiRequestWithMeta<AdminRechargeCustomConfig>('/api/admin/recharge-custom-config', {
    method: 'PUT',
    silent: true,
    body: JSON.stringify(params),
  });
}
