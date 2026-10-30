import { queryOptions } from '@tanstack/react-query';
import { http, apiRequest } from '@/shared/api/http';

export interface AdminSkill {
  id: string;
  creative_skill_id: string | null;
  name: string;
  skill_code: string | null;
  cover_url: string | null;
  category: string;
  sort_order: number;
  is_delete: number;
  has_content: boolean;
}

export interface AdminSkillDetail extends AdminSkill {
  description: string | null;
  content: string | null;
}

export interface AdminSkillPatch {
  name?: string;
  description?: string | null;
  content?: string | null;
  category?: string;
  sort_order?: number;
  cover_url?: string | null;
}

export interface AdminSkillCategory {
  name: string;
  count: number;
}

export function fetchAdminSkills() {
  return http.get<AdminSkill[]>('/api/admin/skills');
}

export function fetchAdminSkillDetail(id: string) {
  return http.get<AdminSkillDetail>(`/api/admin/skills/${id}`);
}

export function fetchAdminSkillCategories() {
  return http.get<AdminSkillCategory[]>('/api/admin/skills/categories');
}

export function updateAdminSkill(id: string, patch: AdminSkillPatch) {
  return apiRequest<{ id: string }>(`/api/admin/skills/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export function setAdminSkillActive(id: string, isDelete: 0 | 1) {
  return apiRequest<{ id: string; is_delete: number }>(
    `/api/admin/skills/${id}/active`,
    {
      method: 'POST',
      body: JSON.stringify({ is_delete: isDelete }),
    },
  );
}

export function setAdminSkillCategory(id: string, category: string) {
  return apiRequest<{ id: string }>(`/api/admin/skills/${id}/category`, {
    method: 'PUT',
    body: JSON.stringify({ category }),
  });
}

export function assignAdminSkillsCategory(ids: string[], category: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/assign', {
    method: 'PUT',
    body: JSON.stringify({ ids, category }),
  });
}

export function renameAdminSkillCategory(from: string, to: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/categories/rename', {
    method: 'PUT',
    body: JSON.stringify({ from, to }),
  });
}

export function deleteAdminSkillCategory(name: string) {
  return apiRequest<{ count: number }>(
    `/api/admin/skills/categories/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}


export const adminSkillKeys = {
  all: ['admin-skills'] as const,
  list: () => [...adminSkillKeys.all, 'list'] as const,
  detail: (id: string) => [...adminSkillKeys.all, 'detail', id] as const,
};

export function adminSkillsOptions() {
  return queryOptions({
    queryKey: adminSkillKeys.list(),
    queryFn: () => fetchAdminSkills(),
  });
}

export function adminSkillDetailOptions(id: string) {
  return queryOptions({
    queryKey: adminSkillKeys.detail(id),
    queryFn: () => fetchAdminSkillDetail(id),
  });
}

export const adminSkillCategoryKeys = {
  all: ['admin-skill-categories'] as const,
  list: () => [...adminSkillCategoryKeys.all, 'list'] as const,
};

export function adminSkillCategoriesOptions() {
  return queryOptions({
    queryKey: adminSkillCategoryKeys.list(),
    queryFn: () => fetchAdminSkillCategories(),
  });
}
