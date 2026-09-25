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

  it('★ billing 抛错时原样冒泡 —— fail closed，扣不动就不要开始干活', async () => {
    const { client } = fakeClient({
      hold: vi.fn().mockRejectedValue(new Error('INSUFFICIENT_CREDITS')),
    } as never);
    const dep = createBillingHold({ client, resolveTier: vi.fn() });

    await expect(dep(CTX)).rejects.toThrow('INSUFFICIENT_CREDITS');
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

    await expect(dep(CTX)).rejects.toThrow('UNAVAILABLE');
  });
});
