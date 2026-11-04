import { describe, expect, it } from 'vitest';
import { shouldRefreshCreditsOf, type TurnAccount } from './sessionTimeline';

const account = (patch: Partial<TurnAccount>): TurnAccount => ({
  batchId: null,
  outcome: 'completed',
  seconds: 3,
  finishedAt: 1,
  tokenUsage: { input_tokens: 10, cached_input_tokens: null, output_tokens: 20, reasoning_tokens: null },
  contextCapacity: null,
  failureText: null,
  failureRetryable: false,
  cardFailureText: null,
  cardFailureRetryable: true,
  ...patch,
});

describe('shouldRefreshCreditsOf', () => {
  it('本轮完成且带回 token 用量时刷新余额', () => {
    expect(shouldRefreshCreditsOf(account({}))).toBe(true);
  });

  it('尚未结算、失败、取消或无用量时不刷新', () => {
    expect(shouldRefreshCreditsOf(null)).toBe(false);
    expect(shouldRefreshCreditsOf(account({ outcome: 'failed' }))).toBe(false);
    expect(shouldRefreshCreditsOf(account({ outcome: 'cancelled' }))).toBe(false);
    expect(shouldRefreshCreditsOf(account({ tokenUsage: null }))).toBe(false);
  });
});
