/* ============================================
 * skills 接口：技能库浏览/添加、我的技能管理、个人技能 CRUD 与 AI 格式化
 * 前缀：/api/agent/skills
 * ============================================ */
import { http } from './http';

/** 技能卡片（技能库 / 我的技能共用） */
export interface SkillRecord {
  /** 稳定身份ID，无版本化映射时为 null */
  creative_skill_id: string | null;
  /** 技能名称 */
  name: string | null;
  /** 技能描述，无描述时为 null */
  description: string | null;
  /** 封面图URL，无封面时为 null */
  cover_url: string | null;
  /** 来源标识，个人技能为 null */
  source: string | null;
  /** 资产域：official 官方 / personal 个人技能 */
  asset_domain: 'official' | 'personal';
  /** 当前用户是否已添加到「我的技能」（技能库返回） */
  added?: boolean;
  /** 所属分类：film/marketing/other（技能库返回） */
  category?: 'film' | 'marketing' | 'other';
  /** 使用人数（技能库返回） */
  usage_count?: number;
  /** 是否自动激活（我的技能返回） */
  auto?: boolean;
}

/** 分页包络 */
export interface SkillPage<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
}

/** 技能库筛选参数 */
export interface LibraryQuery {
  pageNum: number;
  pageSize?: number;
  keyword?: string;
  /** all 全部 / 其余为后台维护的分类名（IKA64P） */
  category?: string;
  /** featured 精选 / most_used 最多使用 / newest 最新发布 */
  sort?: 'featured' | 'most_used' | 'newest';
  /** zh 中文 / en 英文 */
  lang?: 'zh' | 'en';
}

/** 浏览技能库 POST /api/agent/skills/library */
export function fetchSkillLibrary(query: LibraryQuery) {
  return http.post<SkillPage<SkillRecord>>('/api/agent/skills/library', query);
}

/** 用户侧分类列表 GET /api/agent/skills/categories（IKA64P：后台维护的现有分类） */
export function fetchSkillCategories() {
  return http.get<string[]>('/api/agent/skills/categories');
}

/** 添加官方技能到「我的技能」 POST /api/agent/skills/library/:id/add */
export function addLibrarySkill(id: string) {
  return http.post<null>(`/api/agent/skills/library/${encodeURIComponent(id)}/add`);
}

/** 我的技能列表 POST /api/agent/skills/mine */
export function fetchMySkills(pageNum: number, pageSize = 50) {
  return http.post<SkillPage<SkillRecord>>('/api/agent/skills/mine', { pageNum, pageSize });
}

/** 从「我的技能」移除（仅解除引用） DELETE /api/agent/skills/mine/:id */
export function removeMySkill(id: string) {
  return http.del<null>(`/api/agent/skills/mine/${encodeURIComponent(id)}`);
}

/** 切换技能自动激活 PATCH /api/agent/skills/mine/:id */
export function setMySkillAuto(id: string, auto: boolean) {
  return http.patch<null>(`/api/agent/skills/mine/${encodeURIComponent(id)}`, { auto });
}

/** 创建个人技能 POST /api/agent/skills/personal（提交完整 SKILL.md 文本含 frontmatter） */
export function createPersonalSkill(content: string) {
  return http.post<SkillRecord>('/api/agent/skills/personal', { content });
}

/** AI 格式化草稿 POST /api/agent/skills/personal/format（返回完整替换文本，不保存） */
export function formatPersonalSkill(content: string) {
  return http.post<{ content: string }>('/api/agent/skills/personal/format', { content });
}

/** 查看个人技能正文 GET /api/agent/skills/personal/:id（返回重建的 SKILL.md 文本） */
export function fetchPersonalSkill(id: string) {
  return http.get<{ content: string }>(`/api/agent/skills/personal/${encodeURIComponent(id)}`);
}

/** 删除个人技能 DELETE /api/agent/skills/personal/:id（owner-only，不可逆） */
export function deletePersonalSkill(id: string) {
  return http.del<null>(`/api/agent/skills/personal/${encodeURIComponent(id)}`);
}

/* ============ Run 级技能推荐 ============ */

/** Run 推荐技能项 */
export interface RunSkillRecommendation {
  /** 技能稳定身份ID */
  creative_skill_id: string;
  /** 技能名称 */
  name: string;
  /** 技能描述 */
  description: string;
  /** 激活资格：requires_user_use 仅用户点 Use 可激活 */
  activation_eligibility: string;
}

/** 获取 Run 级技能推荐 GET /api/agent/runs/:runId/creative-skill-recommendations */
export function fetchRunSkillRecommendations(runId: number | string) {
  return http.get<RunSkillRecommendation[]>(
    `/api/agent/runs/${runId}/creative-skill-recommendations`,
  );
}
