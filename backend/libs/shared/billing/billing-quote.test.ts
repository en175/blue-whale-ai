import { describe, expect, it, vi } from 'vitest';

import { createBillingHold, type BillingHoldContext } from './billing-hold.js';
import { createBillingQuote, type BillingQuoteContext } from './billing-quote.js';
import type { BillingClient } from './billing-client.js';

/** 造一个把两个 RPC 都记下来的假客户端（另有余额查询的探针：报价**不该**碰它）。 */
function fakeClient(quoteResult: unknown = { credits: 100n, catalogVersion: 3 }) {
  const hold = vi.fn().mockResolvedValue({ reservedCredits: 100, catalogVersion: 3, duplicated: false });
  const quote = vi.fn().mockResolvedValue(quoteResult);
  const queryBalance = vi.fn();
  return {
    client: { hold, quote, queryBalance } as unknown as BillingClient,
    hold,
    quote,
    queryBalance,
  };
}

const CTX: BillingQuoteContext = {
  userId: '42',
  modelId: 'seedance-2.5',
  taskType: 'video',
  input: { size: '2K', duration: 5, references: [{ url: 'x' }], nested: null },
};

describe('createBillingQuote', () => {
  it('★ 规格与 Hold 出自同一套归一 —— 两边看到的 specs 逐字相同', async () => {
    const { client, hold, quote } = fakeClient();

    await createBillingQuote({ client, resolveTier: vi.fn().mockResolvedValue('pro') })(CTX);
    // 同一份 ctx 喂 Hold（报价不写东西，所以不需要 jobId/commandId）
    await createBillingHold({ client, resolveTier: vi.fn().mockResolvedValue('pro') })(
      CTX as unknown as BillingHoldContext,
    );

    const quoteCall = quote.mock.calls[0]?.[0] as { specs?: Record<string, string> } | undefined;
    const holdCall = hold.mock.calls[0]?.[0] as { specs?: Record<string, string> } | undefined;
    expect(quoteCall?.specs).toEqual(holdCall?.specs);
    // 值本身也要对：只取标量、键小写、值小写；数组与 null 不是规格
    //（reference_count 是数组**长度**折算的标量，两边取到同一个数）
    expect(quoteCall?.specs).toEqual({
      size: '2k',
      duration: '5',
      reference_count: '1',
      has_video_input: 'false',
    });
  });

  it('★ 等级透传 —— 报价与预扣必须同一档，否则预览价 != 实扣价', async () => {
    const { client, quote } = fakeClient();

    await createBillingQuote({ client, resolveTier: vi.fn().mockResolvedValue('max') })(CTX);

    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42, modelId: 'seedance-2.5', taskType: 'video', tier: 'max' }),
    );
  });

  it('★ 等级解析失败 → 按 free 报价，不阻断（与 Hold 同一处置）', async () => {
    const { client, quote } = fakeClient();
    const warn = vi.fn();

    const result = await createBillingQuote({
      client,
      resolveTier: vi.fn().mockRejectedValue(new Error('identity 挂了')),
      logger: { warn },
    })(CTX);

    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ tier: 'free' }));
    // 少给折扣是钱漏，不能静默
    expect(warn).toHaveBeenCalled();
    expect(result).toEqual({ credits: 100n, catalogVersion: 3 });
  });

  it('★ 算不出价（UNPRICEABLE，定价漏配）→ 返回 null，不抛不阻断', async () => {
    const { quote } = fakeClient();
    quote.mockRejectedValue(new Error('invalid_argument: UNPRICEABLE'));
    const warn = vi.fn();

    const result = await createBillingQuote({
      client: { hold: vi.fn(), quote } as unknown as BillingClient,
      resolveTier: vi.fn().mockResolvedValue('free'),
      logger: { warn },
    })(CTX);

    // 降级成「这次没有估算」——调用方照常建任务；但要在日志里留下漏配的痕迹
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('★ billing 不可用 → 同样返回 null（这条路径一分钱都不动，不 fail closed）', async () => {
    const { quote } = fakeClient();
    quote.mockRejectedValue(new Error('unavailable'));

    const result = await createBillingQuote({
      client: { hold: vi.fn(), quote } as unknown as BillingClient,
      resolveTier: vi.fn().mockResolvedValue('free'),
      logger: { warn: vi.fn() },
    })(CTX);

    expect(result).toBeNull();
  });

  it('★ 不校验余额 —— 报价只回答「这个组合多少钱」，与用户有多少钱无关', async () => {
    const { client, queryBalance } = fakeClient({
      credits: 9_999n,
      catalogVersion: 4,
    });

    const result = await createBillingQuote({
      client,
      resolveTier: vi.fn().mockResolvedValue('free'),
    })(CTX);

    // 余额为 0 也照样报得出价：契约里报价与余额无关（余额是 Hold 的职责）
    expect(result).toEqual({ credits: 9_999n, catalogVersion: 4 });
    expect(queryBalance).not.toHaveBeenCalled();
  });
});
