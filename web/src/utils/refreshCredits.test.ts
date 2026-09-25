import { describe, expect, it, vi } from 'vitest';
import { refreshQuotaAfterPayment, syncQuotaFromUsageToken } from './refreshQuota';

describe('syncQuotaFromUsageToken', () => {
  it('成功则返回最新配额', async () => {
    await expect(syncQuotaFromUsageToken(async () => 50000)).resolves.toBe(50000);
  });

  it('失败则返回 null', async () => {
    await expect(
      syncQuotaFromUsageToken(async () => {
        throw new Error('network');
      }),
    ).resolves.toBeNull();
  });
});

describe('refreshQuotaAfterPayment', () => {
  it('配额已高于支付前则立刻返回，不重试', async () => {
    const refresh = vi.fn(async () => 100000);
    const sleep = vi.fn(async () => undefined);
    await expect(
      refreshQuotaAfterPayment({
        previousQuota: 0,
        refresh,
        sleep,
        attempts: 5,
      }),
    ).resolves.toBe(100000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('入账延迟时重试直到配额增加', async () => {
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(50000);
    const sleep = vi.fn(async () => undefined);
    await expect(
      refreshQuotaAfterPayment({
        previousQuota: 0,
        refresh,
        sleep,
        attempts: 5,
        intervalMs: 10,
      }),
    ).resolves.toBe(50000);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('始终为 0 也要把最后一次刷新结果写回', async () => {
    const refresh = vi.fn(async () => 0);
    const sleep = vi.fn(async () => undefined);
    await expect(
      refreshQuotaAfterPayment({
        previousQuota: 0,
        refresh,
        sleep,
        attempts: 3,
      }),
    ).resolves.toBe(0);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
