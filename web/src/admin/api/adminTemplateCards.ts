import { queryOptions } from '@tanstack/react-query';
import { http, apiRequest } from '@/api/http';

export interface TemplateImage {
  id: string;
  image_url: string;
  sort_order: number;
}

export interface TemplateCard {
  id: string;
  tag_code: string;
  title: string;
  content: string | null;
  video_url: string | null;
  layout: string;
  sort_order: number;
  images: TemplateImage[];
}

export function fetchTemplateCards(tagCode?: string) {
  const qs = tagCode ? `?tagCode=${encodeURIComponent(tagCode)}` : '';
  return http.get<TemplateCard[]>(`/api/admin/templates${qs}`);
}

export interface TemplateCardPayload {
  title: string;
  tag_code: string;
  layout: string;
  sort_order: number;
  video_url?: string;
  content?: string;
  images?: { id?: string; image_url: string }[];
}

export function createTemplateCard(params: TemplateCardPayload) {
  return http.post<{ id: string }>('/api/admin/templates', params);
}

export function updateTemplateCard(id: string, params: TemplateCardPayload) {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

export function deleteTemplateCard(id: string) {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: 'DELETE',
  });
}

export function moveTemplateCard(id: string, direction: 'up' | 'down') {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

export interface AdminTemplateTag {
  tag_code: string;
  label: string;
  visible: number;
}

export function fetchAdminTemplateTags() {
  return http.get<AdminTemplateTag[]>('/api/admin/template-tags');
}

export function renameAdminTemplateTag(tag_code: string, label: string) {
  return apiRequest<{ tag_code: string }>('/api/admin/template-tags', {
    method: 'PUT',
    body: JSON.stringify({ tag_code, label }),
  });
}

export function setTemplateTagVisibility(tag_code: string, visible: number) {
  return apiRequest<{ tag_code: string; visible: number }>(
    '/api/admin/template-tags/visibility',
    { method: 'PUT', body: JSON.stringify({ tag_code, visible }) },
  );
}

export interface TemplateUploadPresignData {
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
}

export function presignTemplateMedia(params: { type: 'image' | 'video'; mime: string; size: number }) {
  return http.post<TemplateUploadPresignData>('/api/admin/templates/uploads/presign', params);
}

export function completeTemplateMedia(params: {
  type: 'image' | 'video';
  mime: string;
  size: number;
  storage_key: string;
}) {
  return apiRequest<{ url: string }>('/api/admin/templates/uploads/complete', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}


export function moveTemplateImage(id: string, direction: 'up' | 'down') {
  return apiRequest<{ id: string }>(`/api/admin/template-images/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}


export const templateCardKeys = {
  all: ['admin-template-cards'] as const,
  list: (tagCode?: string) => [...templateCardKeys.all, 'list', tagCode ?? ''] as const,
};

export function templateCardsOptions(tagCode?: string) {
  return queryOptions({
    queryKey: templateCardKeys.list(tagCode),
    queryFn: () => fetchTemplateCards(tagCode),
  });
}

export const templateTagKeys = {
  all: ['admin-template-tags'] as const,
  list: () => [...templateTagKeys.all, 'list'] as const,
};

export function templateTagsOptions() {
  return queryOptions({
    queryKey: templateTagKeys.list(),
    queryFn: () => fetchAdminTemplateTags(),
  });
}
