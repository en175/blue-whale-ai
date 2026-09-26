/* ============================================
 * account 接口：账户流水（消费记录），对接真实后端
 * ============================================ */
import { apiRequest } from './http';

/**
 * 账户流水项（GET /api/account/consumptions，读 billing 账本）。
 *
 * ⚠️ **一个业务动作一行**，金额只有一个（`credits`），它是不是最终值看 `status`：
 * `pending` 是「处理中 · 预计消耗」，`done` 才是实际消耗。展示端必须把这两态区分开——
 * 把预计值当成实际扣费是在用户面前把数说错。
 */
export interface ConsumptionRecord {
  /** `res:` / `lot:` / `led:` 前缀 + 来源主键（字符串，别当数字解析） */
  id: string;
  /** consume | recharge | refund | bonus | daily | ... （billing 的类型字面量） */
  type: string;
  /** 方向：in 进账 / out 出账。展示端据此定符号与图标，**别按 credits 正负猜**——
   *  后端给的一律是正的变动幅度。 */
  direction: 'in' | 'out';
  /** 展示文案快照，如「视频生成 · seedance-2.5 1080p 5s」 */
  title: string;
  /** 整数积分 */
  credits: number;
  status: 'pending' | 'done';
  /** RFC3339 */
  created_at: string;
  /** RFC3339，仅 done 时非空 */
  settled_at: string;
}

/**
 * 账户流水分页。
 *
 * ⚠️ 后端是**游标分页**（billing 账本持续追加，offset 会在翻页时漏行或重复行），
 * 所以没有 `total`：把上一页返回的 `next_page_token` 原样回传即可，空串 = 首页。
 *
 * `type` 传**单个**类型（consume / recharge / refund / ...），不传 = 全部流水。
 */
export function fetchConsumptions(pageToken = '', pageSize = 20, type?: string) {
  const qs = new URLSearchParams({ page_size: String(pageSize) });
  if (pageToken) qs.set('page_token', pageToken);
  if (type) qs.set('type', type);
  return apiRequest<{ items: ConsumptionRecord[]; next_page_token: string }>(
    `/api/account/consumptions?${qs.toString()}`,
  );
}
