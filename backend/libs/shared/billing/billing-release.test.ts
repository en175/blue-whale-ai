import { describe, expect, it, vi } from 'vitest';

import {
  BILLING_JOB_FAILED_TOPIC,
  createBillingRelease,
} from './billing-release.js';

describe('createBillingRelease', () => {
  it('发一条 generation-job-failed —— billing 按 job_id 幂等释放那笔预扣', async () => {
    const publish = vi.fn(async () => {});
    const release = createBillingRelease({ publish });

    await release({ userId: '42', jobId: 501, reason: '写库失败' });

    expect(publish).toHaveBeenCalledWith({
      jobId: 501,
      // proto 的 user_id 是 int64：wire 上是数字，别把字符串透传过去
      userId: 42,
      reason: '写库失败',
    });
  });

  it('★ 发布失败不抛错，只记 ERROR —— 它跑在「事务已失败」的路径上，不能盖掉原始错误', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('MQ 挂了'));
    const error = vi.fn();
    const release = createBillingRelease({ publish, logger: { error } });

    await expect(
      release({ userId: '42', jobId: 501, reason: '写库失败' }),
    ).resolves.toBeUndefined();

    // 钱还在 billing 那边冻着，且返还事件没发出去：日志必须带 jobId（运维据此人工释放）
    expect(error).toHaveBeenCalledWith(expect.stringContaining('jobId=501'));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('仍冻着'));
  });

  it('topic 是契约值（与 billing 的 topic-failed / worker 的默认值同名）', () => {
    // ⚠️ 三处（这里、billing application.yml、worker-java JobSettlementPublisher）必须同名：
    //    只改一处就是「事件发出去了但没人消费」——静默且致命。
    expect(BILLING_JOB_FAILED_TOPIC).toBe('generation-job-failed');
  });
});
