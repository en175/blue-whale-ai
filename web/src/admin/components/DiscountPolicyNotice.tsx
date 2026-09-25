/* ============================================
 * 折扣叠加策略的只读提示（会员折扣页 / 限时活动页共用）
 *
 * 它显示的两个值 —— `stackMode` 与 `floorFactorBp` —— 是**定价目录的配置项**，
 * 归属「模型计费」页。但在这两个页面上必须看得见：
 *
 *   · `multiply`：会员折扣 × 活动折扣（8 折再享 7 折 = 5.6 折）
 *   · `best`    ：两者取优，不叠加
 *   · `floorFactorBp`：底线。运营在两张表里各配一个折扣时，没人会心算乘积 ——
 *     底线把「配错」的后果限制在「少赚」而不是「亏本」
 *
 * ⚠️ **只读**：改它要去模型计费页。在这里放一个可编辑的开关，等于让「折扣怎么叠」
 *    这件事有两个入口，而两处各自看起来都正常。
 *
 * ⚠️ 为什么自带数据请求而不是由页面传入：两个折扣页都要这一块，而它要读的是**定价目录**
 *    （整份 JSON，解析逻辑在 ModelBilling 的 `catalogDraft`）。让每个页面各写一遍
 *    「取目录 → 解析 → 取 discountPolicy」，抄漏一步的表现是这一块显示成默认值
 *    （`multiply` / 3000）—— 而默认值与真实配置长得一模一样，没人会发现。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import { billingCatalogOptions } from '@/api/adminBillingCatalog';
import { isApiError } from '@/api/http';
import { parseCatalog, readDiscountPolicy } from '../pages/ModelBilling/catalogDraft';
import { describeFloor, describeStackMode, combineFactors, formatDiscount } from '../discountRules';
import { Alert } from '../ui';

/** 只读提示里那个算例用的倍数。**不是任何一条真实折扣**，只是把「叠加怎么算」说到能心算。 */
const EXAMPLE_MEMBER_BP = 9000;
const EXAMPLE_PROMOTION_BP = 7000;

export default function DiscountPolicyNotice() {
  const catalog = useQuery(billingCatalogOptions());

  if (catalog.isPending) return null;

  if (catalog.isError) {
    // 读不到策略不该挡住折扣的增删改（那是独立的链路），但也不能装作没这回事：
    // 这一块显示的正是「你配的折扣最终会落到什么价」，看不到就是不知道
    return (
      <Alert tone="warning" title="读不到当前的折扣叠加策略">
        定价目录没取到（{isApiError(catalog.error) ? catalog.error.message : '请求失败'}）——
        下面配的折扣最终落到什么价要看它。可去「模型计费」页确认目录是否正常。
      </Alert>
    );
  }

  let stackMode = 'multiply';
  let floorFactorBp = 3000;
  try {
    const policy = readDiscountPolicy(parseCatalog(catalog.data.document));
    stackMode = policy.stackMode;
    floorFactorBp = policy.floorFactorBp;
  } catch {
    // 目录文档解析不了：上面那两个默认值就是计价侧会用的默认值（不是我们编的），
    // 但界面上必须说清这是兜底而不是实际配置
    return (
      <Alert tone="warning" title="定价目录读不出折扣策略，下面按默认值显示">
        目录文档解析失败。计价侧会按 stackMode=multiply、底线 3000 兜底 ——
        请去「模型计费」页确认目录内容。
      </Alert>
    );
  }

  // ⚠️ 算例给的是**两个方式各自的结果**，而不只是当前那个：运营要判断「这条活动配 7 折够不够」，
  //    需要知道的正是「换成另一种方式会变成几折」。只报当前值等于让他自己去心算乘法。
  //
  // 底线也照计价侧的口径取一次 max（`CompositeDiscountResolver` 最后一步）——
  // 算例与真实结果不一致的提示比没有提示更坏。
  const example = (stackMode: string) =>
    Math.max(combineFactors(EXAMPLE_MEMBER_BP, EXAMPLE_PROMOTION_BP, stackMode), floorFactorBp);
  const current = example(stackMode);
  const other = example(stackMode === 'multiply' ? 'best' : 'multiply');

  return (
    <Alert tone="info" title={`当前折扣叠加方式：${describeStackMode(stackMode)}`}>
      同时命中会员折扣与活动时，最终系数按这个方式合并；折扣底线为{' '}
      <b>{describeFloor(floorFactorBp)}</b>（低于它的折扣会被抬到底线，防配错亏本）。
      这两项是<b>目录级配置</b>，本页只读 —— 要改去「模型计费」页的「目录设置」。
      <div style={{ marginTop: 6 }}>
        例：会员 {formatDiscount(EXAMPLE_MEMBER_BP)} 与活动 {formatDiscount(EXAMPLE_PROMOTION_BP)}{' '}
        同时命中 → 当前方式得 <b>{formatDiscount(current)}</b>；另一种方式是{' '}
        {formatDiscount(other)}。
      </div>
    </Alert>
  );
}
