import { describe, expect, it, vi } from 'vitest';

import { createBillingHold, type BillingHoldContext } from './billing-hold.js';
import { createBillingQuote, type BillingQuoteContext } from './billing-quote.js';
import type { BillingClient } from './billing-client.js';

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
    await createBillingHold({ client, resolveTier: vi.fn().mockResolvedValue('pro') })(
      CTX as unknown as BillingHoldContext,
    );

    const quoteCall = quote.mock.calls[0]?.[0] as { specs?: Record<string, string> } | undefined;
    const holdCall = hold.mock.calls[0]?.[0] as { specs?: Record<string, string> } | undefined;
    expect(quoteCall?.specs).toEqual(holdCall?.specs);
    expect(quoteCall?.specs).toEqual({
      size: '2k',
      duration: '5',
      reference_count: '1',
      video: '0',
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
    expect(warn).toHaveBeenCalled();
    expect(result).toEqual({ credits: 100n, catalogVersion: 3, tier: 'free' });
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

    expect(result).toEqual({ credits: 9_999n, catalogVersion: 4, tier: 'free' });
    expect(queryBalance).not.toHaveBeenCalled();
  });
});
