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
 * ⚠️ 2026-09-30 后端由**游标**改成 **offset 页码 + 总数**（`common/v1/types.proto` 的
 * PageRequest/PageResponse 同批改动）。原注释写的「账本持续追加，offset 会在翻页时漏行」
 * **仍然成立**，是产品要「共 N 条」与页码换来的，见对接文档 §6.2。
 *
 * ⚠️ 改了 offset 之后**没有游标可回传**：`page` 是从 1 起的页码，`total` 是总数。
 *
 * `type` 现在支持**逗号分隔的多值**（如 `consume,expire`），不传 = 全部流水。
 *
 * ⚠️ 调用方（账户记录弹窗）目前只用第一页；要用到翻页时请按 `page` / `total` 接。
 */
export function fetchConsumptions(page = 1, pageSize = 20, type?: string) {
  const qs = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (type) qs.set('type', type);
  return apiRequest<{ items: ConsumptionRecord[]; total: number }>(
    `/api/account/consumptions?${qs.toString()}`,
  );
}
