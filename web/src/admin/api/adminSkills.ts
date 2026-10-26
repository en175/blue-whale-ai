import { queryOptions } from '@tanstack/react-query';
import { http, apiRequest } from '@/shared/api/http';

export interface AdminSkill {
  id: string;
  name: string;
  cover_url: string | null;
  category: string;
  sort_order: number;
}

export interface AdminSkillCategory {
  name: string;
  count: number;
}

export function fetchAdminSkills() {
  return http.get<AdminSkill[]>('/api/admin/skills');
}

export function fetchAdminSkillCategories() {
  return http.get<AdminSkillCategory[]>('/api/admin/skills/categories');
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
};

export function adminSkillsOptions() {
  return queryOptions({
    queryKey: adminSkillKeys.list(),
    queryFn: () => fetchAdminSkills(),
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
