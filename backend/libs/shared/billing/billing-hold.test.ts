import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it, vi } from 'vitest';

import { createBillingHold, type BillingHoldContext } from './billing-hold.js';
import type { BillingClient } from './billing-client.js';

/** 造一个记录调用的假客户端。 */
function fakeClient(overrides: Partial<BillingClient> = {}) {
  const hold = overrides.hold ?? vi.fn().mockResolvedValue({ reservedCredits: 100, catalogVersion: 1, duplicated: false });
  return { client: { hold } as unknown as BillingClient, hold: hold as ReturnType<typeof vi.fn> };
}

const CTX: BillingHoldContext = {
  userId: '42',
  jobId: 501,
  commandId: 'cmd-1',
  modelId: 'seedance-2.5',
  taskType: 'video',
  input: { size: '2K', duration: 5, references: [{ url: 'x' }], nested: null },
};

describe('createBillingHold', () => {
  it('★ 按上下文调 hold —— 没有「跳过预扣」的分支', async () => {
    const { client, hold } = fakeClient();
    const dep = createBillingHold({
      client,
      resolveTier: vi.fn().mockResolvedValue('pro'),
    });

    await dep(CTX);

    expect(hold).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        jobId: 501,
        commandId: 'cmd-1',
        modelId: 'seedance-2.5',
        taskType: 'video',
        tier: 'pro',
      }),
    );
  });

  it('规格只取标量、键统一小写（对象/数组/空值不进规格）', async () => {
    const { client, hold } = fakeClient();
    const dep = createBillingHold({ client, resolveTier: vi.fn() });

    await dep(CTX);

    const specs = hold.mock.calls[0]?.[0].specs as Record<string, string>;
    // reference_count 是 `references` 的**长度**折算出来的标量（定价要的是数量）：
    // 数组本身仍不进规格，见下一行
    expect(specs).toEqual({ size: '2k', duration: '5', reference_count: '1' });
    // 数组与 null 不是规格——混进去会让 catalog 的规格表查不到，变成 UNPRICEABLE
    expect(specs).not.toHaveProperty('references');
    expect(specs).not.toHaveProperty('nested');
  });

  it('★ 等级解析失败 → 按 free 继续，不阻断提交', async () => {
    const { client, hold } = fakeClient();
    const warn = vi.fn();
    const dep = createBillingHold({
      client,
      resolveTier: vi.fn().mockRejectedValue(new Error('identity 挂了')),
      logger: { warn },
    });

    await dep(CTX);

    expect(hold).toHaveBeenCalledWith(expect.objectContaining({ tier: 'free' }));
    // 不静默：等级取不到意味着这个用户可能被少给了折扣
    expect(warn).toHaveBeenCalled();
  });

  it('等级解析失败不影响 billing 本身抛出的错', async () => {
    const { client } = fakeClient({
      hold: vi.fn().mockRejectedValue(new Error('UNAVAILABLE')),
    } as never);
    const dep = createBillingHold({
      client,
      resolveTier: vi.fn().mockRejectedValue(new Error('identity 挂了')),
      logger: { warn: vi.fn() },
    });

    // 认不出的错误照原样抛（那是我们自己的 bug，不该伪装成上游故障）
    await expect(dep(CTX)).rejects.toThrow('UNAVAILABLE');
  });
});

/**
 * 契约那三条失败语义在这里换掉**对外的身份**（映射本体在 billing-client 的 toBillingHoldError）。
 *
 * <p>钉的是**真跑出来**的那个 bug：目录里漏配一个模型，用户拿到 `HTTP 500
 * {"code":500,"msg":"服务器内部错误"}` —— 像我们挂了；而 billing 其实说了「这个组合算不出价」。
 *
 * <p>⚠️ 每条都仍然是**拒绝**（fail closed 不变）：变的只是以什么状态、什么话被拒。
 */
describe('createBillingHold：被拒时的对外身份', () => {
  it('billing 不可用（UNAVAILABLE）→ 503：仍是拒绝，但这次重试有意义', async () => {
    const { client } = fakeClient({
      hold: vi.fn().mockRejectedValue(new ConnectError('connection refused', Code.Unavailable)),
    } as never);
    const dep = createBillingHold({ client, resolveTier: vi.fn() });

    await expect(dep(CTX)).rejects.toMatchObject({ status: 503 });
  });

  it('★ 算不出价（UNPRICEABLE）→ 400 + 人话，**不再是 500**；原文只进日志', async () => {
    const warn = vi.fn();
    const { client } = fakeClient({
      hold: vi
        .fn()
        .mockRejectedValue(
          new ConnectError('UNPRICEABLE: 未配置计价规则：seedance-2.5/video', Code.InvalidArgument),
        ),
    } as never);
    const dep = createBillingHold({ client, resolveTier: vi.fn(), logger: { warn } });

    const error = await dep(CTX).catch((e: unknown) => e);

    // 用户能自己改（换一个模型）：给 4xx 和一句人话
    expect(error).toMatchObject({ code: 1005, status: 400 });
    expect((error as Error).message).not.toMatch(/UNPRICEABLE|未配置计价规则/);
    // 运营要的是原文：漏配清单就是从这批日志里攒出来的
    expect(warn.mock.calls[0]?.[0]).toContain('UNPRICEABLE');
  });

  it('★ 余额不足（INSUFFICIENT_CREDITS）→ 402：前端正是按 402 弹充值框', async () => {
    const { client } = fakeClient({
      hold: vi
        .fn()
        .mockRejectedValue(
          new ConnectError('INSUFFICIENT_CREDITS: 可用余额 0', Code.FailedPrecondition),
        ),
    } as never);
    const dep = createBillingHold({ client, resolveTier: vi.fn() });

    await expect(dep(CTX)).rejects.toMatchObject({ code: 1001, status: 402 });
  });
});
