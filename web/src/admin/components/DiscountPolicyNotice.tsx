/* ============================================
 * 折扣叠加策略的只读提示（会员折扣页 / 限时活动页共用）
 *
 * 它显示的两个值 —— `stackMode` 与 `floorFactorBp` —— 是**定价目录的配置项**，
 * 归属「系统管理 → 计费」页。但在这两个页面上必须看得见：
 *
 *   · `multiply`：会员折扣 × 活动折扣（8 折再享 7 折 = 5.6 折）
 *   · `best`    ：两者取优，不叠加
 *   · `floorFactorBp`：底线。运营在两张表里各配一个折扣时，没人会心算乘积 ——
 *     底线把「配错」的后果限制在「少赚」而不是「亏本」
 *
 * ⚠️ **只读**：这两项由**定价目录**承载（模型计费页已下线，「系统管理 → 计费」是它们的编辑入口；
 *    「定价」tab —— 但那里改的是一条模型的价，不是这两个目录级参数）。在这里放一个可编辑的
 *    开关，等于让「折扣怎么叠」这件事有两个入口，而两处各自看起来都正常。
 *
 * ⚠️ 为什么自带数据请求而不是由页面传入：两个折扣页都要这一块，而它要读的是**定价目录**
 *    （整份 JSON，解析逻辑在 `lib/billing-catalog/catalogDraft`）。让每个页面各写一遍
 *    「取目录 → 解析 → 取 discountPolicy」，抄漏一步的表现是这一块显示成默认值
 *    （`multiply` / 3000）—— 而默认值与真实配置长得一模一样，没人会发现。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import { billingCatalogOptions } from '@/api/adminBillingCatalog';
import { isApiError } from '@/api/http';
import { parseCatalog, readDiscountPolicy } from '../lib/billing-catalog/catalogDraft';
import { describeFloor, describeStackMode, combineFactors, formatDiscount } from '../discountRules';
import { Alert, Hint, MetaRow } from '../ui';

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
        下面配的折扣最终落到什么价要看它。请确认定价目录接口是否正常。
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
        请检查定价目录内容。
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

  // 「现在是什么」用 MetaRow 直说，不铺色块 —— 色块占了整屏宽、五行字，而读者要的只是两个值。
  // 解释与算例收进值后面的 `?`。
  return (
    // 不加底色：这条 meta 只有两个值，铺一条整屏宽的浅灰底就是「98% 是空的色块」——
    // 装饰，不是信息。安静地排在副标题下面即可。
    <MetaRow
      items={[
        {
          label: '折扣叠加方式',
          value: (
            <>
              {describeStackMode(stackMode)}{' '}
              <Hint title="这两项是什么">
                <div>
                  同时命中会员折扣与活动时，最终系数按<b>这个方式</b>合并。
                  它是<b>目录级配置</b>，本页只读 —— 改值要走定价目录发布流程
                  （模型列表的「定价」tab 改的是单个模型的价，不是这两个全局参数）。
                </div>
                <div>
                  例：会员 {formatDiscount(EXAMPLE_MEMBER_BP)} 与活动{' '}
                  {formatDiscount(EXAMPLE_PROMOTION_BP)} 同时命中 → 当前方式得{' '}
                  <b>{formatDiscount(current)}</b>；换成另一种方式会得{' '}
                  {formatDiscount(other)}。
                </div>
              </Hint>
            </>
          ),
        },
        {
          label: '折扣底线',
          value: (
            <>
              {describeFloor(floorFactorBp)}{' '}
              <Hint title="折扣底线">
                合并出来的折扣低于它会<b>被抬到底线</b>：运营在两张表里各配一个折扣时没人会心算乘积，
                底线把「配错」的后果限制在「少赚」而不是「亏本」。同为目录级配置，本页只读。
              </Hint>
            </>
          ),
        },
      ]}
    />
  );
}
