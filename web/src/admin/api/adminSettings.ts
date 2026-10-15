import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/api/http';

export interface SystemCredentials {
  hccb_mch_no: string;
  hccb_app_id: string;
  hccb_app_secret: string;
  hccb_notify_url: string;
}

export interface SystemUpstream {
  new_api_key: string;
}

export interface SystemPolicy {
  refund_text: string;
  invoice_text: string;
}

export interface SystemRateLimit {
  rate_per_min: number;
  rate_per_hour: number;
  concurrent: number;
  burst: number;
}

export interface SystemSettings {
  credentials: SystemCredentials;
  upstream: SystemUpstream;
  policy: SystemPolicy;
  rateLimit: SystemRateLimit;
}

export function fetchAdminSettings() {
  return apiRequest<SystemSettings>('/api/admin/settings');
}

export function updateAdminSettings(
  params: Partial<{
    credentials: Partial<SystemCredentials>;
    upstream: Partial<SystemUpstream>;
    policy: Partial<SystemPolicy>;
    rateLimit: Partial<SystemRateLimit>;
  }>
) {
  return apiRequest<null>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}


export const adminSettingsKeys = {
  all: ['admin-settings'] as const,
};

export function adminSettingsOptions() {
  return queryOptions({
    queryKey: adminSettingsKeys.all,
    queryFn: () => fetchAdminSettings(),
  });
}
