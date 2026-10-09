import { queryOptions } from '@tanstack/react-query';
import { http, apiRequest } from './http';

export interface ModelSize {
  id: string;
  label?: string;
}

export type AdminAspectRatio = string | { id: string; label?: string };

export interface DurationRange {
  min: number;
  max: number;
  step?: number;
}

export interface AdminModel {
  id: string;
  provider_id: string;
  model_id: string;
  capability_type: 'image' | 'video' | 'text' | 'audio';
  model_label: string;
  icon: string | null;
  supported_sizes: ModelSize[];
  supported_aspect_ratios: AdminAspectRatio[];
  supported_durations: number[] | DurationRange | null;
  supported_formats: string[];
  default_size: string | null;
  default_format: string | null;
  default_aspect_ratio: string | null;
  default_duration: number | null;
  features: Record<string, unknown>;
  channel?: string | null;
  request_mapping?: unknown;
  pricing?: unknown;
  enabled: boolean;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function fetchAdminModels() {
  return http.get<AdminModel[]>('/api/admin/models');
}

export interface CreateAdminModelParams {
  provider_id?: string;
  model_id: string;
  capability_type: 'image' | 'video' | 'text' | 'audio';
  model_label: string;
  icon?: string | null;
  supported_sizes?: ModelSize[];
  supported_aspect_ratios?: AdminAspectRatio[];
  supported_durations?: number[] | DurationRange | null;
  supported_formats?: string[];
  default_size?: string | null;
  default_format?: string | null;
  default_aspect_ratio?: string | null;
  default_duration?: number | null;
  features?: Record<string, unknown>;
  channel?: string | null;
  request_mapping?: unknown;
  pricing?: unknown;
  enabled?: boolean;
  sort_order?: number;
}

export function createAdminModel(params: CreateAdminModelParams) {
  return http.post<AdminModel>('/api/admin/models', params);
}

export function updateAdminModel(id: string, params: Partial<CreateAdminModelParams>) {
  return apiRequest<AdminModel>(`/api/admin/models/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export function toggleAdminModel(id: string) {
  return apiRequest<AdminModel>(`/api/admin/models/${id}/toggle`, {
    method: 'PATCH',
  });
}

export function setAdminModelDefault(id: string) {
  return apiRequest<AdminModel[]>(`/api/admin/models/${id}/default`, {
    method: 'PATCH',
  });
}

export function deleteAdminModel(id: string) {
  return apiRequest<unknown>(`/api/admin/models/${id}`, {
    method: 'DELETE',
  });
}


export const adminModelKeys = {
  all: ['admin-models'] as const,
  list: () => [...adminModelKeys.all, 'list'] as const,
};

export function adminModelsOptions() {
  return queryOptions({
    queryKey: adminModelKeys.list(),
    queryFn: () => fetchAdminModels(),
  });
}
