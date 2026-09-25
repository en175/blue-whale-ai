/* ============================================
 * 管理端 API：会员等级折扣（billing_member_discounts）
 *
 * `GET/POST/PUT/DELETE /api/admin/billing-discounts`（后端转发 billing 的管理端 HTTP 面）。
 *
 * ⚠️ 这里**没有「发布」动作**，与模型计费（定价目录）相反：定价目录是「一个版本 = 一份 JSON，
 *    整份发布、整份回滚」，而折扣是 **live 表** —— 保存即生效，下次预扣就会命中。
 *    两条链路的分界在于「是否影响已提交任务」：目录用版本边界冻结，折扣用
 *    「预扣时把命中的系数冻进预留行」（`billing_cost_reservations.discount_bp`）冻结。
 *
 * ⚠️ 单位：接口上收发的 `discountBp` 是**万分比**（9000 = 9 折）。界面按「折」编辑与展示，
 *    换算是页面的事（`admin/discountRules.ts`）——引擎与账本的单位不动。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface MemberDiscount {
  id: number;
  /** free | basic | pro | max */
  tier: string;
  /** 模型匹配：`*` / `seedance-*` / 精确 id */
  modelPattern: string;
  /** 任务匹配：`*` / `text2video` */
  taskPattern: string;
  /** 万分比（9000 = 9 折） */
  discountBp: number;
  /** 同等级命中多条时取最优惠；此项只用于展示排序 */
  priority: number;
  /** enabled | disabled */
  status: string;
  gmtCreate: string;
  gmtModified: string;
}

/** 写入形态：每一列都要给（PUT 是**整条覆盖**，不是部分更新）。 */
export interface MemberDiscountInput {
  tier: string;
  modelPattern: string;
  taskPattern: string;
  discountBp: number;
  priority: number;
  status: string;
}

export const memberDiscountKeys = {
  all: ['admin-member-discounts'] as const,
  list: () => [...memberDiscountKeys.all, 'list'] as const,
};

export function fetchMemberDiscounts(): Promise<MemberDiscount[]> {
  // silent：失败由页面自己用 Alert 呈现（与模型计费页同一口径，交给 http 层弹 toast 会重复）
  return apiRequest<MemberDiscount[]>('/api/admin/billing-discounts', { silent: true });
}

export function createMemberDiscount(input: MemberDiscountInput): Promise<MemberDiscount> {
  // 不 silent：保存失败（配错了 / billing 不可用）必须当场弹出来
  return apiRequest<MemberDiscount>('/api/admin/billing-discounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateMemberDiscount(
  id: number,
  input: MemberDiscountInput,
): Promise<MemberDiscount> {
  return apiRequest<MemberDiscount>(`/api/admin/billing-discounts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteMemberDiscount(id: number): Promise<unknown> {
  return apiRequest<unknown>(`/api/admin/billing-discounts/${id}`, { method: 'DELETE' });
}

export function memberDiscountsOptions() {
  return queryOptions({
    queryKey: memberDiscountKeys.list(),
    queryFn: fetchMemberDiscounts,
  });
}
