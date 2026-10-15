import { http } from '@/shared/api/http';

export interface SkillRecord {
  creative_skill_id: string | null;
  name: string | null;
  description: string | null;
  cover_url: string | null;
  source: string | null;
  asset_domain: 'official' | 'personal';
  added?: boolean;
  category?: 'film' | 'marketing' | 'other';
  usage_count?: number;
}

export interface SkillPage<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
}

export interface LibraryQuery {
  pageNum: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  sort?: 'featured' | 'most_used' | 'newest';
  lang?: 'zh' | 'en';
}

export function fetchSkillLibrary(query: LibraryQuery) {
  return http.post<SkillPage<SkillRecord>>('/api/agent/skills/library', query);
}

export function fetchSkillCategories() {
  return http.get<string[]>('/api/agent/skills/categories');
}

export function addLibrarySkill(id: string) {
  return http.post<null>(`/api/agent/skills/library/${encodeURIComponent(id)}/add`);
}

export function fetchSkillContent(id: string) {
  return http.get<{ content: string }>(`/api/agent/skills/library/${encodeURIComponent(id)}/content`);
}

export function fetchMySkills(pageNum: number, pageSize = 50) {
  return http.post<SkillPage<SkillRecord>>('/api/agent/skills/mine', { pageNum, pageSize });
}

export function removeMySkill(id: string) {
  return http.del<null>(`/api/agent/skills/mine/${encodeURIComponent(id)}`);
}

export function createPersonalSkill(content: string) {
  return http.post<SkillRecord>('/api/agent/skills/personal', { content });
}

export function formatPersonalSkill(content: string) {
  return http.post<{ content: string }>('/api/agent/skills/personal/format', { content });
}

export function fetchPersonalSkill(id: string) {
  return http.get<{ content: string }>(`/api/agent/skills/personal/${encodeURIComponent(id)}`);
}

export function deletePersonalSkill(id: string) {
  return http.del<null>(`/api/agent/skills/personal/${encodeURIComponent(id)}`);
}
