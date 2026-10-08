import { Code, ConnectError } from '@connectrpc/connect';
import { create } from '@bufbuild/protobuf';
import { DomainError } from '@lib/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  BILLING_URL_ENV,
  billingEndpoint,
  createBillingClient,
  missingBillingConfig,
  toBillingHoldError,
} from './billing-client.js';
import {
  freshGrpcUrl,
  grpcBillingService,
  grpcStubTransport,
} from './billing-admin-grpc-stub.testlib.js';
import {
  QueryBalanceResponseSchema,
  SourceCreditsSchema,
} from '../../contracts/gen/billing/v1/billing_pb.js';

vi.mock('@connectrpc/connect-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectrpc/connect-node')>();
  return { ...actual, createGrpcTransport: () => grpcStubTransport() };
});

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

describe('toBillingHoldError（Hold 的三条失败语义）', () => {
  function rpc(rawMessage: string, code: Code): ConnectError {
    return new ConnectError(rawMessage, code);
  }

  it('★ 算不出价（UNPRICEABLE）→ 4xx + 人话，**不再是 500**', () => {
    const mapped = toBillingHoldError(
      rpc(
        'UNPRICEABLE: 未配置计价规则：doubao-seedream-5-0-pro-260628/image',
        Code.InvalidArgument,
      ),
    );

    expect(mapped).toBeInstanceOf(DomainError);
    expect(mapped).toMatchObject({ code: 1005, status: 400 });
    expect(mapped?.message).toBe('模型未开通或不可用');
  });

  it('★ 原因词与内部细节不外泄 —— 用户看不懂 UNPRICEABLE，也不必知道是哪个模型漏配', () => {
    const mapped = toBillingHoldError(
      rpc(
        'UNPRICEABLE: 未配置计价规则：doubao-seedream-5-0-pro-260628/image',
        Code.InvalidArgument,
      ),
    );

    expect(mapped?.message).not.toMatch(/UNPRICEABLE|未配置计价规则|doubao-seedream/);
  });

  it('余额不足（INSUFFICIENT_CREDITS）→ 402 + 码表里那句「账户余额不足，请充值后重试」', () => {
    const mapped = toBillingHoldError(
      rpc('INSUFFICIENT_CREDITS: 可用余额 0，本次需 100', Code.FailedPrecondition),
    );

    expect(mapped).toMatchObject({ code: 1001, status: 402 });
    expect(mapped?.message).toBe('账户余额不足，请充值后重试');
  });

  it('billing 不可用（UNAVAILABLE / DeadlineExceeded）→ 503：运维问题，重试有意义', () => {
    for (const code of [Code.Unavailable, Code.DeadlineExceeded]) {
      expect(toBillingHoldError(rpc('connection refused', code))).toMatchObject({
        status: 503,
        code: 'billing_unavailable',
      });
    }
  });

  it('★ 码与原因词**一起**判：别的 INVALID_ARGUMENT 不许被当成「算不出价」', () => {
    const mapped = toBillingHoldError(rpc('duration 必须是正整数', Code.InvalidArgument));

    expect(mapped).toMatchObject({ status: 502, code: 'billing_error' });
  });

  it('billing 内部错误 → 502，既不是 500 也不是「算不出价」', () => {
    expect(toBillingHoldError(rpc('billing 内部错误', Code.Internal))).toMatchObject({
      status: 502,
    });
  });

  it('认不出的错误返回 null —— 我们自己的 bug 不伪装成上游故障（照旧 500）', () => {
    expect(toBillingHoldError(new Error('BigInt 转换炸了'))).toBeNull();
    expect(toBillingHoldError('boom')).toBeNull();
  });
});

describe('queryBalance 的投影', () => {
  it('★ 按来源拆分的分项逐项映射出来，且不丢精度（int64 → number）', async () => {
    freshGrpcUrl();
    grpcBillingService({
      queryBalance: (req) => {
        expect(Number(req.userId)).toBe(9001);
        return create(QueryBalanceResponseSchema, {
          availableCredits: 2_500n,
          frozenCredits: 100n,
          expiring: [],
          bySource: [
            create(SourceCreditsSchema, { source: 'purchased', credits: 1_500n }),
            create(SourceCreditsSchema, { source: 'bonus', credits: 1_000n }),
          ],
        });
      },
    });

    const balance = await createBillingClient(billingEndpoint()).queryBalance(9001);

    expect(balance.availableCredits).toBe(2_500);
    expect(balance.frozenCredits).toBe(100);
    expect(balance.bySource).toEqual([
      { source: 'purchased', credits: 1_500 },
      { source: 'bonus', credits: 1_000 },
    ]);
  });

  it('老 billing 不带 by_source → 空数组，不是 undefined（消费端不必判空）', async () => {
    freshGrpcUrl();
    grpcBillingService({
      queryBalance: () =>
        create(QueryBalanceResponseSchema, { availableCredits: 7n, frozenCredits: 0n }),
    });

    const balance = await createBillingClient(billingEndpoint()).queryBalance(9001);

    expect(balance.bySource).toEqual([]);
  });
});
