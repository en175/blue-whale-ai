/* ============================================
 * 管理端 API：限时活动（billing_promotions）
 *
 * `GET/POST/PUT/DELETE /api/admin/billing-promotions`（后端转发 billing 的管理端 HTTP 面）。
 *
 * ⚠️ 与会员折扣同一条冻结语义：**改活动不影响已提交未结算的任务**。
 *    提交时把命中的系数冻进预留行，结算按冻结值复现 —— 详见页面上的提示条。
 *
 * ⚠️ 四个条件列（`modelIds` / `taskTypes` / `tierScope` / `daysOfWeek`）在接口上是
 *    **解析后的数组**，`null` 表示「不限 / 全天」。空数组在写入时会被后端归一成 null：
 *    「不限」在整条链路上只有一种表示，否则「界面上清空了」这件事要靠读代码才知道。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface Promotion {
  id: number;
  /** 活动标识，唯一，审计/排查用 */
  code: string;
  name: string;
  /** 万分比（7000 = 7 折） */
  discountBp: number;
  /** 模型范围，至少一个；`*` = 全部 */
  modelIds: string[];
  /** 任务范围；null = 不限 */
  taskTypes: string[] | null;
  /** 适用等级；null = 不限 */
  tierScope: string[] | null;
  /** 起始时间（含），**活动时区下的墙钟**：`2026-10-01T00:00:00` */
  startAt: string;
  /** 结束时间（**不含**） */
  endAt: string;
  /** 每日时段起；与 end 同时为 null = 全天 */
  dailyTimeStart: string | null;
  /** 每日时段止，可跨天（22:00→06:00） */
  dailyTimeEnd: string | null;
  /** 生效星期 [1..7]，1 = 周一；null = 每天 */
  daysOfWeek: number[] | null;
  /** 时区，必填。跨零点时段靠它算对 */
  tz: string;
  /** draft | enabled | disabled | expired */
  status: string;
  priority: number;
  /** 谁建的（后端记当前管理员的 userId） */
  createdBy: string;
  gmtCreate: string;
  gmtModified: string;
}

/**
 * 写入形态：**每一列都要给**，`null` 是「不限 / 全天」这个明确的状态，不是「没填」。
 *
 * <p>为什么把可选字段也写成必需的：`PUT` 是整条覆盖，如果允许 `undefined`，
 * 「没给」与「给了个默认值」就会混在一起 —— 一次漏字段的保存会把
 * 「限 3 个模型」悄悄改成「不限」，而界面上看不出发生过这件事。
 */
export interface PromotionInput {
  code: string;
  name: string;
  discountBp: number;
  modelIds: string[];
  taskTypes: string[] | null;
  tierScope: string[] | null;
  startAt: string;
  endAt: string;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  daysOfWeek: number[] | null;
  tz: string;
  status: string;
  priority: number;
}

export const promotionKeys = {
  all: ['admin-billing-promotions'] as const,
  list: () => [...promotionKeys.all, 'list'] as const,
};

export function fetchPromotions(): Promise<Promotion[]> {
  return apiRequest<Promotion[]>('/api/admin/billing-promotions', { silent: true });
}

export function createPromotion(input: PromotionInput): Promise<Promotion> {
  return apiRequest<Promotion>('/api/admin/billing-promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updatePromotion(id: number, input: PromotionInput): Promise<Promotion> {
  return apiRequest<Promotion>(`/api/admin/billing-promotions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deletePromotion(id: number): Promise<unknown> {
  return apiRequest<unknown>(`/api/admin/billing-promotions/${id}`, { method: 'DELETE' });
}

export function promotionsOptions() {
  return queryOptions({
    queryKey: promotionKeys.list(),
    queryFn: fetchPromotions,
  });
}
