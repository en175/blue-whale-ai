/**
 * skills —— Skill 面板后端 API 请求层（IJZ7Z8；IK60WS 切稳定身份）。
 *
 * 走本地 Next 路由 /api/agent/skills/*（BFF 直连数据库），同源无 CORS。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 *
 * wire 一律 snake_case（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §3/§6）：
 * 唯一公开主键 creative_skill_id，分页壳 records/total/current/size（无 pages）。
 * library 分页（POST，默认 50/页），mine 同样 POST 分页。
 */
import { apiFetch } from "@/lib/api-client";

/** library 视图（契约 §3 白名单；creative_skill_id 可空：目录行缺版本化映射时为 null，命令按不存在处理；
 *  name/description 为按请求语言解析后的单值；usage_count 为成功激活去重用户数） */
export type SkillLibraryItem = {
  creative_skill_id: string | null;
  name: string;
  description: string | null;
  cover_url: string | null;
  source: string;
  asset_domain: "official";
  added: boolean;
  category: string;
  usage_count: number;
};

/** mine 视图（契约 §3 白名单：官方引用 ∪ 名下个人技能；personal 行 cover_url/source 为 null、auto 恒 false） */
export type SkillMineItem = {
  creative_skill_id: string | null;
  auto: boolean;
  name: string | null;
  description: string | null;
  cover_url: string | null;
  source: string | null;
  asset_domain: "official" | "personal";
};

/** BFF 分页壳（snake_case wire：records/total/current/size，无 pages） */
export type Page<T> = {
  records: T[];
  total: number;
  current: number;
  size: number;
};

/** library 浏览参数（契约 §11.5：category 缺省 all，sort 缺省 featured，lang 缺省 zh） */
export type SkillLibraryCategory = "all" | "film" | "marketing" | "other";
export type SkillLibrarySort = "featured" | "most_used" | "newest";
export type SkillLibraryLang = "zh" | "en";

export type LibraryQuery = {
  pageNum: number;
  pageSize: number;
  keyword?: string;
  category?: SkillLibraryCategory;
  sort?: SkillLibrarySort;
  lang?: SkillLibraryLang;
};

/** Run 级 Creative Skill 推荐项（IK3NPI，wire snake_case；后端四字段契约） */
export type CreativeSkillRecommendation = {
  /** Creative Skill 稳定身份（Use 强制激活用） */
  creative_skill_id: string;
  name: string;
  description: string;
  /** 激活资格，契约恒为 requires_user_use（仅用户点 Use 可激活） */
  activation_eligibility: "requires_user_use";
};

const API_BASE = "/api/agent/skills";

async function request<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  return requestUrl<T>(`${API_BASE}${path}`, method, body);
}

/** 全路径请求（推荐端点等在 /api/agent/skills 之外的 Run 级 API 复用） */
async function requestUrl<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("后端未启动或无法连接");
  }
  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`上游响应非 JSON（HTTP ${res.status}）`);
  }
  if (json.code !== 200) {
    throw new Error(json.msg || `请求失败 (${json.code})`);
  }
  return json.data as T;
}

export const skillsApi = {
  /** Skill 库分页（POST，默认 50/页；keyword 搜解析语言 name/description 与 search_keywords，
   *  category 过滤、featured/most_used/newest 排序、zh/en 语言解析，契约 §11） */
  library: (q: LibraryQuery) =>
    request<Page<SkillLibraryItem>>("/library", "POST", q),
  /** 我的 Skills 分页（POST，与 library 一致滚动加载） */
  mine: (q: { pageNum: number; pageSize: number }) =>
    request<Page<SkillMineItem>>("/mine", "POST", q),
  /** 添加到我的（默认 auto=false）；creativeSkillId 即 creative_skill_id */
  add: (creativeSkillId: string) =>
    request<void>(`/library/${creativeSkillId}/add`, "POST"),
  /** 从我的移除（不删 skill 本身）；creativeSkillId 即 creative_skill_id */
  remove: (creativeSkillId: string) =>
    request<void>(`/mine/${creativeSkillId}`, "DELETE"),
  /** 切换 auto（关系属性，持久化）；creativeSkillId 即 creative_skill_id */
  setAuto: (creativeSkillId: string, auto: boolean) =>
    request<void>(`/mine/${creativeSkillId}`, "PATCH", { auto }),
  /** 创建个人技能（IK60WU）；content 为完整 SKILL.md 文本（含 frontmatter） */
  createPersonalSkill: (content: string) =>
    request<SkillMineItem>("/personal", "POST", { content }),
  /** 当前 Run 的 Creative Skill 推荐列表（IK3NPI，GET，Run 级端点不在 skills base 下） */
  recommendations: (runId: number) =>
    requestUrl<CreativeSkillRecommendation[]>(
      `/api/agent/runs/${runId}/creative-skill-recommendations`,
      "GET",
    ),
};
