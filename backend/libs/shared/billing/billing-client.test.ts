import { describe, expect, it } from 'vitest';

import {
  BILLING_URL_ENV,
  billingEndpoint,
  missingBillingConfig,
} from './billing-client.js';

/**
 * 计费地址的**存在性**守卫。
 *
 * <p>钉的是「配置缺失时到底发生什么」。曾经这里是「返回空串 = 没有客户端 = 跳过预扣」，
 * new-api 被切断之后那就是一条**静默的免费通道**：少配一个变量，全站生成都不扣钱，
 * 而且没有任何报错——用户白拿，我们白干，账上什么都看不出来。
 */
describe('billingEndpoint', () => {
  it('配了就返回', () => {
    expect(billingEndpoint({ [BILLING_URL_ENV]: ' http://billing:9100 ' })).toBe(
      'http://billing:9100',
    );
  });

  it('★ 没配就抛，不是返回空串 —— 空串等于「跳过预扣」', () => {
    expect(() => billingEndpoint({})).toThrow(/BILLING_GRPC_URL/);
  });

  it('★ 只填空格也算没配 —— 空白串骗过配置检查是最典型的部署事故', () => {
    expect(() => billingEndpoint({ [BILLING_URL_ENV]: '   ' })).toThrow(/BILLING_GRPC_URL/);
  });

  it('报错里带变量名，运维知道该去配什么', () => {
    expect(() => billingEndpoint({})).toThrow(/BILLING_GRPC_URL/);
  });
});

describe('missingBillingConfig', () => {
  it('两项都缺时两个都报出来（不要修一个再发现还有一个）', () => {
    expect(missingBillingConfig({})).toEqual(['BILLING_GRPC_URL', 'NEW_API_UPSTREAM_KEY']);
  });

  it('齐备时返回空数组', () => {
    expect(
      missingBillingConfig({
        [BILLING_URL_ENV]: 'http://billing:9100',
        NEW_API_UPSTREAM_KEY: 'sk-upstream',
      }),
    ).toEqual([]);
  });

  it('★ 缺 NEW_API_UPSTREAM_KEY 也算不齐 —— 它现在是登录的硬依赖', () => {
    // 只判 billing 地址会漏掉这一项，而缺它的表现是「所有人都登不上」，
    // 比不扣钱还早暴露，但同样是启动时才该拦下的配置错误。
    expect(missingBillingConfig({ [BILLING_URL_ENV]: 'http://billing:9100' })).toEqual([
      'NEW_API_UPSTREAM_KEY',
    ]);
  });

  it('空白串不算配了', () => {
    expect(
      missingBillingConfig({
        [BILLING_URL_ENV]: '  ',
        NEW_API_UPSTREAM_KEY: '\t',
      }),
    ).toEqual(['BILLING_GRPC_URL', 'NEW_API_UPSTREAM_KEY']);
  });
});
