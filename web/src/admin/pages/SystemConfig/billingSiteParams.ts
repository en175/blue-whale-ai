/* ============================================
 * 站点级计费参数的纯逻辑：合法区间、校验、发布备注。
 *
 * 与 `BillingTab.tsx` 分开放的理由和 `ModelList/model-form.ts` 同一条：
 * 这些是**钱**的口径与算法，必须能单测，而不是埋在 JSX 的事件处理里。
 *
 * ── 与 billing 的关系 ────────────────────────────────────────────────────────
 *
 * 唯一的权威是 billing 的编译期（`CatalogCompiler`）：整份目录编不过就整份拒绝。
 * 这里拦的只是同一口径里一眼能看出的错（空着、不是整数、多敲一个 0），并且**措辞照抄**
 * 编译器的拒绝语 —— 同一个错误在两个地方有两种说法，比没有校验更让人糊涂。
 *
 * ⚠️ **不在这里做编译期之外的事**：目录能不能编过由 billing 说了算，别把它的校验抄第二份到这里。
 * ============================================ */
import {
  readCreditsPerYuan,
  readDiscountPolicy,
  type CatalogDocumentJson,
} from '../../lib/billing-catalog/catalogDraft';

/**
 * 换算率的合法区间 —— 与 billing `CatalogDocument.MIN_CREDITS_PER_YUAN` /
 * `MAX_CREDITS_PER_YUAN` 逐字一致（下界 1：0 或负数意味着「多少元都换不到积分」；
 * 上界 100000：「1 元 = 10 万积分」这种量级几乎必定是多敲了几个 0）。
 */
export const MIN_CREDITS_PER_YUAN = 1;
export const MAX_CREDITS_PER_YUAN = 100_000;

/**
 * 折扣底线的上界。
 *
 * <p>billing 没对它做编译期校验（`DiscountPolicy.floorFactorBp` 只是个 Integer），
 * 但计价侧取的是 `max(折扣, 底线)`（`CompositeDiscountResolver` 最后一步）——
 * 超过 10000 等于把「打折」抬成**加价**，那不是防亏本，是改价目表。这里拦住它。
 */
export const MAX_FLOOR_FACTOR_BP = 10_000;

const WHOLE_NUMBER = /^\d+$/;

/**
 * 换算率文本 → 错误文案（合法返回 null）。
 *
 * @returns 越界时**逐字照抄 billing `CatalogCompiler#compileCreditsPerYuan` 的拒绝口径**
 *          （`creditsPerYuan=X 不合法：它表示「1 元等于多少积分」，合法范围 1 ~ 100000…`）。
 */
export function creditsPerYuanError(text: string): string | null {
  const raw = text.trim();
  if (!WHOLE_NUMBER.test(raw)) {
    return '换算率必须是正整数（1 元等于多少积分，如 15）';
  }
  const value = Number(raw);
  if (value < MIN_CREDITS_PER_YUAN || value > MAX_CREDITS_PER_YUAN) {
    return `creditsPerYuan=${value} 不合法：它表示「1 元等于多少积分」，合法范围 ${MIN_CREDITS_PER_YUAN} ~ ${MAX_CREDITS_PER_YUAN}（超过上界说明多半是多敲了 0）`;
  }
  return null;
}

/** 折扣底线文本 → 错误文案（合法返回 null）。 */
export function floorFactorBpError(text: string): string | null {
  const raw = text.trim();
  if (!WHOLE_NUMBER.test(raw)) {
    return '折扣底线必须是整数（万分比：3000 = 3 折，10000 = 不打折）';
  }
  const value = Number(raw);
  if (value < 1) {
    return '折扣底线必须大于 0（万分比：3000 = 3 折，10000 = 不打折）';
  }
  if (value > MAX_FLOOR_FACTOR_BP) {
    return `折扣底线不能超过 ${MAX_FLOOR_FACTOR_BP}：计价侧取的是 max(折扣, 底线)，超过 ${MAX_FLOOR_FACTOR_BP} 会把折扣抬成加价`;
  }
  return null;
}

/** 发布时写进目录的三个值（存储单位：整数换算率 / 策略名 / 整数万分比）。 */
export interface SiteParams {
  creditsPerYuan: number;
  stackMode: string;
  floorFactorBp: number;
}

/** 目录里的值 → 输入框文本。读不出来时给空串（**不拿 0 冒充**：0 是非法值，却看起来像配过）。 */
export function textOf(value: number | null): string {
  return value === null ? '' : String(value);
}

/**
 * 发布备注：写进目录行的 `note`，是事后唯一能回答「这版为什么改」的地方。
 *
 * <p>按**实际变了的项**写，而不是一句「改了计费参数」：只动换算率的一次发布，
 * 不该在历史里看起来像改过折扣策略。
 */
export function buildNote(before: CatalogDocumentJson, after: SiteParams): string {
  const beforeRate = readCreditsPerYuan(before);
  const beforePolicy = readDiscountPolicy(before);
  const changes: string[] = [];
  if (beforeRate !== after.creditsPerYuan) {
    changes.push(`换算率 ${beforeRate ?? '（空）'} → ${after.creditsPerYuan}`);
  }
  if (beforePolicy.stackMode !== after.stackMode) {
    changes.push(`折扣叠加方式 ${beforePolicy.stackMode} → ${after.stackMode}`);
  }
  if (beforePolicy.floorFactorBp !== after.floorFactorBp) {
    changes.push(`折扣底线 ${beforePolicy.floorFactorBp} → ${after.floorFactorBp}`);
  }
  return `系统设置·计费：${changes.join('；')}`;
}
