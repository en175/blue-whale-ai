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
  it('缺 billing 地址就报出来', () => {
    expect(missingBillingConfig({})).toEqual(['BILLING_GRPC_URL']);
  });

  it('齐备时返回空数组', () => {
    expect(missingBillingConfig({ [BILLING_URL_ENV]: 'http://billing:9100' })).toEqual([]);
  });

  it('★ 上游 key 不再参与这道门 —— 它是配置表里的数据，不是环境变量', () => {
    // 它曾经在这里，理由是「缺它登录就签发不出会话」。两件事变了：
    //   1. 值搬到 system_settings（管理端可配），查 process.env 永远查不到——留着就是恒真的废话；
    //   2. 登录不再需要它（会话只记身份）。把它留作启动门禁会把新部署卡成死循环：
    //      key 要在管理端填，管理端要先登得进来，而进程根本不起。
    // 它的 fail-closed 改落在真正打上游的地方（见 UpstreamCredentialMissingError）。
    const env = {
      [BILLING_URL_ENV]: 'http://billing:9100',
      NEW_API_UPSTREAM_KEY: 'sk-upstream',
    } as NodeJS.ProcessEnv;
    expect(missingBillingConfig(env)).toEqual([]);
    expect(missingBillingConfig({})).not.toContain('NEW_API_UPSTREAM_KEY');
  });

  it('空白串不算配了', () => {
    expect(missingBillingConfig({ [BILLING_URL_ENV]: '  ' })).toEqual(['BILLING_GRPC_URL']);
  });
});
