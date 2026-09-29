/* ============================================
 * 后台管理 API · 技能与技能分类。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { http, apiRequest } from './http';

/** 官方技能（管理视图） */
export interface AdminSkill {
  id: string;
  name: string;
  cover_url: string | null;
  category: string;
  sort_order: number;
}

/** 分类聚合（含计数） */
export interface AdminSkillCategory {
  name: string;
  count: number;
}

/** GET /api/admin/skills 官方技能列表 */
export function fetchAdminSkills() {
  return http.get<AdminSkill[]>('/api/admin/skills');
}

/** GET /api/admin/skills/categories 现有分类（含计数） */
export function fetchAdminSkillCategories() {
  return http.get<AdminSkillCategory[]>('/api/admin/skills/categories');
}

/** PUT /api/admin/skills/:id/category 技能归类（新分类随归类创建） */
export function setAdminSkillCategory(id: string, category: string) {
  return apiRequest<{ id: string }>(`/api/admin/skills/${id}/category`, {
    method: 'PUT',
    body: JSON.stringify({ category }),
  });
}

/** PUT /api/admin/skills/assign 批量归类（IKA64P 效率优化） */
export function assignAdminSkillsCategory(ids: string[], category: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/assign', {
    method: 'PUT',
    body: JSON.stringify({ ids, category }),
  });
}

/** PUT /api/admin/skills/categories/rename 分类批量改名 */
export function renameAdminSkillCategory(from: string, to: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/categories/rename', {
    method: 'PUT',
    body: JSON.stringify({ from, to }),
  });
}

/** DELETE /api/admin/skills/categories/:name 删除分类（其下技能变未分类） */
export function deleteAdminSkillCategory(name: string) {
  return apiRequest<{ count: number }>(
    `/api/admin/skills/categories/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}

// ---------- TanStack Query 工厂 ----------

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
