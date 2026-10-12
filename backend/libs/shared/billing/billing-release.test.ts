import { describe, expect, it, vi } from 'vitest';

import {
  BILLING_JOB_TERMINAL_TOPIC,
  createBillingRelease,
} from './billing-release.js';

describe('createBillingRelease', () => {
  it('发一条 generation-job-terminal（status=failed）—— billing 按 job_id 幂等退款', async () => {
    const publish = vi.fn(async () => {});
    const release = createBillingRelease({ publish });

    await release({ userId: '42', jobId: 501, reason: '写库失败' });

    expect(publish).toHaveBeenCalledWith({
      jobId: 501,
      userId: 42,
      status: 'failed',
      reason: '写库失败',
      refund: true,
    });
  });

  it('★ 发布失败不抛错，只记 ERROR —— 它跑在「事务已失败」的路径上，不能盖掉原始错误', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('MQ 挂了'));
    const error = vi.fn();
    const release = createBillingRelease({ publish, logger: { error } });

    await expect(
      release({ userId: '42', jobId: 501, reason: '写库失败' }),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('jobId=501'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('仍扣着'));
  });

  it('topic 是契约值（与 billing 的 topic-terminal / worker 的默认值同名）', () => {
    expect(BILLING_JOB_TERMINAL_TOPIC).toBe('generation-job-terminal');
  });
});
