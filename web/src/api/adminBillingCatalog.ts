/* ============================================
 * 管理端 API：模型计费（定价目录）
 *
 * `GET /api/admin/billing-catalog` 读当前生效目录；`POST` **整份发布**一份新的。
 *
 * ⚠️ 这里**没有「改某一行」的接口**，也不该有：billing 的目录是「一个版本 = 一份 JSON」，
 *    job 提交时冻结版本号、结算按冻结版本复现。行级增量发布没有版本边界，改价会影响到
 *    已提交任务 —— 所以前端只能是「读出整份 → 改 → 发布整份」。
 *
 * ⚠️ `document` 全程是**文本**（不是对象）：后端把它原样转发给 billing，billing 存原文、
 *    对原文取 hash。中间任何一次「解析再序列化」都会改变 hash 的对应物，出问题时就没法
 *    拿运营提交的内容与库里那份逐字节比对了。解析只为**编辑**，发回去的一定是序列化后的
 *    那份文本本身。
 *
 * ⚠️ 响应里**没有** `ruleCount`：目录曾经装着每个模型的计价规则，那些规则已搬进模型能力行
 *    （`generation_model_capability.pricing`），目录现在只装 `creditsPerYuan` 与 `discountPolicy`
 *    两项全局配置，没有「规则条数」可报（billing 的响应里也一并删了这个字段）。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export interface BillingCatalog {
  /** 生效版本号；**-1 = 还没有任何生效目录**（正常状态，不是错误） */
  catalogVersion: number;
  /** 发布时对**提交文本**取的 SHA-256。⚠️ 与 `document` 的 hash 不相等（见 `document`） */
  documentHash: string;
  /** 1 元 = 多少积分；没有生效目录时 -1 */
  creditsPerYuan: number;
  /**
   * 目录文档文本（未发布过时为空串）。
   *
   * ⚠️ 它是 MySQL JSON 列的规范化形态，**不是**当初提交的那串字节。判断「有没有改过」
   *    必须比**解析后的对象**（见 `catalogDraft.ts` 的 `isCatalogDirty`），比文本会让
   *    一次没改过的保存凭空多出版本。
   */
  document: string;
}

export interface PublishBillingCatalogInput {
  /** 目录 JSON 文本（`JSON.stringify(草稿)`） */
  document: string;
  /** 备注，写进目录行的 note：事后要能回答「这版价为什么改」 */
  note?: string;
}

export interface PublishBillingCatalogResult {
  catalogVersion: number;
  documentHash: string;
  creditsPerYuan: number;
}

export const billingCatalogKeys = {
  all: ['admin-billing-catalog'] as const,
  active: () => [...billingCatalogKeys.all, 'active'] as const,
};

export function fetchBillingCatalog(): Promise<BillingCatalog> {
  // silent：失败由页面自己用 Alert 呈现（这里不只一处会失败，交给 http 层弹 toast 会重复）
  return apiRequest<BillingCatalog>('/api/admin/billing-catalog', { silent: true });
}

export function publishBillingCatalog(
  input: PublishBillingCatalogInput,
): Promise<PublishBillingCatalogResult> {
  // 不 silent：发布失败（文档被拒 / billing 不可用）必须当场弹出来
  return apiRequest<PublishBillingCatalogResult>('/api/admin/billing-catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function billingCatalogOptions() {
  return queryOptions({
    queryKey: billingCatalogKeys.active(),
    queryFn: fetchBillingCatalog,
  });
}
