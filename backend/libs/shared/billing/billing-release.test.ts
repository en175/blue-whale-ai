import { describe, expect, it, vi } from 'vitest';

import {
  createBillingRelease,
  createOutboxTerminalEnqueue,
} from './billing-release.js';

describe('createBillingRelease', () => {
  it('把退款意图写进持久 outbox，由 worker 统一投递', async () => {
    const enqueue = vi.fn(async () => {});
    const release = createBillingRelease({ enqueue });

    await release({ userId: '42', jobId: 501, reason: '写库失败' });

    expect(enqueue).toHaveBeenCalledWith({
      userId: '42',
      jobId: 501,
      reason: '写库失败',
    });
  });

  it('★ 入队失败不抛错，只记 ERROR —— 它跑在「事务已失败」的路径上，不能盖掉原始错误', async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error('DB 挂了'));
    const error = vi.fn();
    const release = createBillingRelease({ enqueue, logger: { error } });

    await expect(
      release({ userId: '42', jobId: 501, reason: '写库失败' }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('jobId=501'));
  });
});

describe('createOutboxTerminalEnqueue', () => {
  it('写 generation_outbox 的 failed 行，退款由 worker 按状态推导', async () => {
    const create = vi.fn(async () => ({}));
    const enqueue = createOutboxTerminalEnqueue({
      generation_outbox: { create },
    });

    await enqueue({ userId: '42', jobId: 501, reason: 'x'.repeat(600) });

    expect(create).toHaveBeenCalledWith({
      data: {
        job_id: 501n,
        user_id: 42n,
        terminal_status: 'failed',
        reason: 'x'.repeat(512),
      },
    });
  });
});
