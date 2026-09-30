/* ============================================
 * 管理端 API：任务记录（`GET /api/admin/job-records`）
 *
 * 数据源是我们自己的 `generation_jobs`（本地表），offset 分页 + 有总数。
 *
 * ⚠️ 这一页**不是账单**：任务 ≠ 消费。任务可能失败全额返还（用户净变化 0，
 *    账本里不会出现一行消费），也可能一个任务对应多次扣费。要看钱去积分记录页。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface AdminJobRecord {
  job_id: string;
  /** 归属用户（bigint 字符串，超出 JS 安全整数范围也不丢精度） */
  user_id: string;
  /**
   * 用户名。BFF 回我们自己的库按 `user_id` 补的——`generation_jobs` 里只有 user_id，认不出人。
   *
   * ⚠️ 键名是 `nickname`，界面上叫「用户名」，值都是 `bw_users.username`。
   *    键名沿用身份查询那层（`AdminUserIdentity.nickname`，与用户管理页、积分记录页共用一份），
   *    在这里改键只会让三个页面的同一个字段叫两个名字。
   *
   * ⚠️ 可选（`?`）不是多余：与积分记录页同一条规矩 —— **后端比前端旧**时这个键**整个不存在**，
   *    拿到的是 `undefined`。判空一律写 `?? '—'`，写 `=== null` 会漏掉一半。
   *
   * `null` = 查不到这个用户（已被清理）**或**这个用户没有手机号 —— 后端已经把两种收敛成
   * 同一种，**没有第二种「没有」**。
   */
  nickname?: string | null;
  /** 手机号。可选性与 `null` 的含义与上面的 `nickname` 逐字相同 */
  phone?: string | null;
  /** 画布项目 id；不在项目里的任务为空串 */
  project_id: string;
  /** 任务类型（text2video / audio_mix / …）。自由文本——后端不写死白名单，新类型不会被误伤 */
  type: string;
  /** queued | running | succeeded | failed | … */
  status: string;
  /** 0–100 */
  progress: number;
  /**
   * 这次任务用的模型（`generation_jobs.input.model_id`）；没有模型的任务（免费工具族）为 null。
   *
   * <p>⚠️ 只带 model 这一项，**不带整份 input**：input 里有提示词、素材 id、规格参数，
   *    为了一列把整份搬到列表上，接口体积会跟着 input 的结构一起长。
   */
  model_id: string | null;
  /**
   * 模型的展示名（能力表 `generation_model_capability.model_label`）。
   *
   * <p>`null` = 能力表里查不到这个 model_id（下架了、或本来就只在目录里配了价）。
   *    展示口径：**有展示名用展示名，否则原样显示 `model_id`** —— 不要自己拼一个名字。
   */
  model_label: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  /** 失败原因（与用户在任务详情里看到的是同一份文案）；未失败为 null */
  error: { code: number; message: string } | null;
}

export interface AdminJobRecordListData {
  list: AdminJobRecord[];
  total: number;
}

export interface AdminJobRecordQuery {
  page: number;
  pageSize: number;
  /**
   * 用户 ID / 手机号 / 用户名，**都要完整**（服务端精确匹配，收敛到唯一一个人）。空 = 全部用户。
   *
   * ⚠️ 与用户管理页那个 `keyword` 是**两种东西**：那边是模糊匹配，这边必须唯一命中。
   *    同样的输入在两页行为不同，所以输入框的 placeholder 要写明「需完整」。
   */
  keyword?: string;
  projectId?: string;
  /** 空 = 全部类型 */
  type?: string;
  /** 空 = 全部状态 */
  status?: string;
}

export const adminJobRecordKeys = {
  all: ['admin-job-records'] as const,
  list: (query: AdminJobRecordQuery) => [...adminJobRecordKeys.all, query] as const,
};

export function fetchAdminJobRecords(
  query: AdminJobRecordQuery,
): Promise<AdminJobRecordListData> {
  const qs = new URLSearchParams();
  qs.set('page', String(query.page));
  qs.set('pageSize', String(query.pageSize));
  if (query.keyword) qs.set('keyword', query.keyword);
  if (query.projectId) qs.set('projectId', query.projectId);
  if (query.type) qs.set('type', query.type);
  if (query.status) qs.set('status', query.status);
  return apiRequest<AdminJobRecordListData>(`/api/admin/job-records?${qs.toString()}`, {
    silent: true,
  });
}

export function adminJobRecordsOptions(query: AdminJobRecordQuery) {
  return queryOptions({
    queryKey: adminJobRecordKeys.list(query),
    queryFn: () => fetchAdminJobRecords(query),
  });
}
