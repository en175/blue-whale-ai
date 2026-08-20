import { describe, expect, it } from 'vitest';
import { deriveAgentPhase } from './agentSessionState';

const user = (id: string) => ({ id, role: 'user' as const, blocks: [] });
const assistant = (id: string, blocks: { type: string }[] = []) => ({
  id,
  role: 'assistant' as const,
  blocks,
});

describe('deriveAgentPhase', () => {
  it('returns to idle after an ordinary terminal assistant response', () => {
    expect(
      deriveAgentPhase({
        messages: [user('u1'), assistant('a1'), user('u2'), assistant('a2')],
        running: false,
        streaming: false,
        failed: false,
        sessionPhase: 'open',
        paymentRequired: false,
      }),
    ).toBe('idle');
  });

  it('keeps actionable non-running states distinct from processing', () => {
    expect(
      deriveAgentPhase({
        messages: [user('u1')],
        running: true,
        streaming: false,
        failed: false,
        sessionPhase: 'open',
        paymentRequired: true,
      }),
    ).toBe('payment_required');
  });
});
