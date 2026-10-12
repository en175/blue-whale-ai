import { Code, ConnectError } from '@connectrpc/connect';
import { describe, expect, it, vi } from 'vitest';

import { createBillingCharge, type BillingChargeContext } from './billing-charge.js';
import type { BillingClient } from './billing-client.js';

function fakeClient(overrides: Partial<BillingClient> = {}) {
  const charge = overrides.charge ?? vi.fn().mockResolvedValue({ chargedCredits: 100, catalogVersion: 1, duplicated: false });
  return { client: { charge } as unknown as BillingClient, charge: charge as ReturnType<typeof vi.fn> };
}

const CTX: BillingChargeContext = {
  userId: '42',
  jobId: 501,
  commandId: 'cmd-1',
  modelId: 'seedance-2.5',
  taskType: 'video',
  input: { size: '2K', duration: 5, references: [{ url: 'x' }], nested: null },
};

describe('createBillingCharge', () => {
  it('★ 按上下文调 charge —— 没有「跳过预扣」的分支', async () => {
    const { client, charge } = fakeClient();
    const dep = createBillingCharge({
      client,
      resolveTier: vi.fn().mockResolvedValue('pro'),
    });

    await dep(CTX);

    expect(charge).toHaveBeenCalledWith(
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
    const { client, charge } = fakeClient();
    const dep = createBillingCharge({ client, resolveTier: vi.fn() });

    await dep(CTX);

    const specs = charge.mock.calls[0]?.[0].specs as Record<string, string>;
    expect(specs).toEqual({
      size: '2k',
      duration: '5',
      reference_count: '1',
      video: '0',
    });
    expect(specs).not.toHaveProperty('references');
    expect(specs).not.toHaveProperty('nested');
  });

  it('★ 等级解析失败 → 按 free 继续，不阻断提交', async () => {
    const { client, charge } = fakeClient();
    const warn = vi.fn();
    const dep = createBillingCharge({
      client,
      resolveTier: vi.fn().mockRejectedValue(new Error('identity 挂了')),
      logger: { warn },
    });

    await dep(CTX);

    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ tier: 'free' }));
    expect(warn).toHaveBeenCalled();
  });

  it('等级解析失败不影响 billing 本身抛出的错', async () => {
    const { client } = fakeClient({
      charge: vi.fn().mockRejectedValue(new Error('UNAVAILABLE')),
    } as never);
    const dep = createBillingCharge({
      client,
      resolveTier: vi.fn().mockRejectedValue(new Error('identity 挂了')),
      logger: { warn: vi.fn() },
    });

    await expect(dep(CTX)).rejects.toThrow('UNAVAILABLE');
  });
});

describe('createBillingCharge：被拒时的对外身份', () => {
  it('billing 不可用（UNAVAILABLE）→ 503：仍是拒绝，但这次重试有意义', async () => {
    const { client } = fakeClient({
      charge: vi.fn().mockRejectedValue(new ConnectError('connection refused', Code.Unavailable)),
    } as never);
    const dep = createBillingCharge({ client, resolveTier: vi.fn() });

    await expect(dep(CTX)).rejects.toMatchObject({ status: 503 });
  });

  it('★ 算不出价（UNPRICEABLE）→ 400 + 人话，**不再是 500**；原文只进日志', async () => {
    const warn = vi.fn();
    const { client } = fakeClient({
      charge: vi
        .fn()
        .mockRejectedValue(
          new ConnectError('UNPRICEABLE: 未配置计价规则：seedance-2.5/video', Code.InvalidArgument),
        ),
    } as never);
    const dep = createBillingCharge({ client, resolveTier: vi.fn(), logger: { warn } });

    const error = await dep(CTX).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 1005, status: 400 });
    expect((error as Error).message).not.toMatch(/UNPRICEABLE|未配置计价规则/);
    expect(warn.mock.calls[0]?.[0]).toContain('UNPRICEABLE');
  });

  it('★ 余额不足（INSUFFICIENT_CREDITS）→ 402：前端正是按 402 弹充值框', async () => {
    const { client } = fakeClient({
      charge: vi
        .fn()
        .mockRejectedValue(
          new ConnectError('INSUFFICIENT_CREDITS: 可用余额 0', Code.FailedPrecondition),
        ),
    } as never);
    const dep = createBillingCharge({ client, resolveTier: vi.fn() });

    await expect(dep(CTX)).rejects.toMatchObject({ code: 1001, status: 402 });
  });
});
