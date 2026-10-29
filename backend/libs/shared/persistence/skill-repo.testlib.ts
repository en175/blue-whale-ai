import {expect, vi} from "vitest";


export const FORBIDDEN_KEYS = ["content", "body", "prompt", "id", "skill_id"];

export function expectWhitelistOnly(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  }
}

export function withTransaction(
  tx: Record<string, unknown>,
): { $transaction: ReturnType<typeof vi.fn> } {
  return {
    $transaction: vi.fn(
      async (cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(tx),
    ),
  };
}
