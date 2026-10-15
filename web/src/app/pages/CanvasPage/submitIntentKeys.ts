import { newIdempotencyKey } from '@/shared/api/idempotencyKey';

export interface SubmitIntentKeys {
  keyFor(scope: string, signature: string): string;
  settle(scope: string): void;
}

export function createSubmitIntentKeys(): SubmitIntentKeys {
  const held = new Map<string, { signature: string; key: string }>();
  return {
    keyFor(scope, signature) {
      const current = held.get(scope);
      if (current?.signature === signature) return current.key;
      const key = newIdempotencyKey();
      held.set(scope, { signature, key });
      return key;
    },
    settle(scope) {
      held.delete(scope);
    },
  };
}
