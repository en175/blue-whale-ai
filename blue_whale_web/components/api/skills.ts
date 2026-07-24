/**
 * skills —— Skill 面板后端 API 请求层（IJZ7Z8）。
 *
 * 走 Next rewrite /api/agent/skills/* → 网关 → agent-service（见 next.config.ts），同源无 CORS。
 * 鉴权统一走 apiFetch：登录态自动附 Authorization，401 自动刷新。
 *
 * 字段命名：agent-service 未配 Jackson SNAKE_CASE，字段按 Java 原样 camelCase 输出
 * （skillId / coverUrl / records / current / pages）。已对齐后端实际返回，勿改回 snake_case。
 * library 分页（POST，默认 50/页），mine 一次返全（用户添加数量有限）。
 */
import { apiFetch } from "@/lib/api-client";

export type SkillLibraryItem = {
  id: number;
  name: string;
  description: string;
  coverUrl: string | null;
  source: string;
  added: boolean;
  /** Creative Skill 稳定身份（IK3NPB，wire snake_case；Use 强制激活用） */
  creative_skill_id: string | null;
};

export type SkillMineItem = {
  skillId: number;
  auto: boolean;
  name: string;
  description: string;
  coverUrl: string | null;
  source: string;
  /** Creative Skill 稳定身份（IK3NPB，wire snake_case；Use 强制激活用） */
  creative_skill_id: string | null;
};

/** MyBatis-Plus Page 序列化结构（camelCase） */
export type Page<T> = {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
};

export type LibraryQuery = {
  pageNum: number;
  pageSize: number;
  keyword?: string;
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
  /** Skill 库分页（POST，默认 50/页，可 keyword 搜 name/description） */
  library: (q: LibraryQuery) =>
    request<Page<SkillLibraryItem>>("/library", "POST", q),
  /** 我的 Skills 分页（POST，与 library 一致滚动加载） */
  mine: (q: { pageNum: number; pageSize: number }) =>
    request<Page<SkillMineItem>>("/mine", "POST", q),
  /** 添加到我的（默认 auto=false） */
  add: (id: number) => request<void>(`/library/${id}/add`, "POST"),
  /** 从我的移除（不删 skill 本身） */
  remove: (id: number) => request<void>(`/mine/${id}`, "DELETE"),
  /** 切换 auto（关系属性，持久化） */
  setAuto: (id: number, auto: boolean) =>
    request<void>(`/mine/${id}`, "PATCH", { auto }),
  /** 当前 Run 的 Creative Skill 推荐列表（IK3NPI，GET，Run 级端点不在 skills base 下） */
  recommendations: (runId: number) =>
    requestUrl<CreativeSkillRecommendation[]>(
      `/api/agent/runs/${runId}/creative-skill-recommendations`,
      "GET",
    ),
};
