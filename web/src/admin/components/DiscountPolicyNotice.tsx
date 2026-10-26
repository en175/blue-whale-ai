import { useQuery } from '@tanstack/react-query';
import { billingCatalogOptions } from '@/admin/api/adminBillingCatalog';
import { isApiError } from '@/shared/api/http';
import { parseCatalog, readDiscountPolicy } from '../utils/billing-catalog/catalogDraft';
import { describeFloor, describeStackMode, combineFactors, formatDiscount } from '../discountRules';
import { Alert, Hint, MetaRow } from '../ui';

const EXAMPLE_MEMBER_BP = 9000;
const EXAMPLE_PROMOTION_BP = 7000;

export default function DiscountPolicyNotice() {
  const catalog = useQuery(billingCatalogOptions());

  if (catalog.isPending) return null;

  if (catalog.isError) {
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
    return (
      <Alert tone="warning" title="定价目录读不出折扣策略，下面按默认值显示">
        目录文档解析失败。计价侧会按 stackMode=multiply、底线 3000 兜底 ——
        请检查定价目录内容。
      </Alert>
    );
  }

  const example = (stackMode: string) =>
    Math.max(combineFactors(EXAMPLE_MEMBER_BP, EXAMPLE_PROMOTION_BP, stackMode), floorFactorBp);
  const current = example(stackMode);
  const other = example(stackMode === 'multiply' ? 'best' : 'multiply');

  return (
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
