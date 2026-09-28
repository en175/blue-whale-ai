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

// 真 gRPC 客户端这一跳要走内存 router 桩（见 billing-admin-grpc-stub.testlib.ts 的文件头）：
// 走真 transport 会真连出去，而「忘了装桩」会表现成一次网络抖动，而不是测试自己写漏了。
vi.mock('@connectrpc/connect-node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@connectrpc/connect-node')>();
  return { ...actual, createGrpcTransport: () => grpcStubTransport() };
});

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

/**
 * Hold 被拒 → 对外错误（契约 billing.proto 逐字写下的三条失败语义）。
 *
 * <p>钉的是那个**真跑出来**的 bug：目录里漏配一个模型，用户拿到的是
 * `HTTP 500 {"code":500,"msg":"服务器内部错误"}` —— 看起来像我们挂了。可 billing 其实把话说得
 * 很清楚（`[invalid_argument] UNPRICEABLE: 未配置计价规则：<模型>/<类型>`），只是这层没认它。
 *
 * <p>造错误的方式照**线上形状**来：服务端把原因词拼在 gRPC status description 前缀上
 * （`<REASON>: <中文说明>`），到客户端这侧就是 `rawMessage`；`message` 会再带一层
 * `[invalid_argument] ` 前缀（实测栈里就是那个样子）。
 */
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

    // 用户能自己处理（换一个模型），所以给 4xx；500 会让他以为是我们挂了。
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
    // 402 不是随手挑的：前端的余额门正是按 `status === 402` 弹充值框（web/src/utils/creditsGate.ts）。
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
    // billing 也用 INVALID_ARGUMENT 回参数问题（description 里没有 UNPRICEABLE 这个词）。
    // 那是我们发出去的请求本身有问题，不是「这个模型用不了」——归错类会把排查方向带偏。
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

/**
 * 真 gRPC 客户端这一跳的映射（proto → `BillingBalance`）。
 *
 * <p>为什么单独钉：Java 适配器有测试、Nest 控制器有测试，**中间这一层此前一条都没有**。
 * 漏一个字段、少一次 `Number()` 的话三边同时绿，而界面上只是「余额分类那部分永远不出现」
 * ——不报错、不掉数，最难发现的那种。
 *
 * <p>桩是**内存 router**（真过一遍 protobuf 序列化），所以 int64 → `bigint` → `Number()`
 * 这条折算也一并钉住了；手写假 client 会把这一层整个跳过。
 */
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
    // ⚠️ 这里必须是 number 而不是 bigint：`by_source` 的和要拿去与
    //    `availableCredits` 相加比较，混进 bigint 会让 `sum !== credits` 恒真，
    //    于是前端永远走「退回服务端总额」那条分支、分类数字永远不显示。
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
