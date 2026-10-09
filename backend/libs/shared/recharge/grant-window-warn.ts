
export const GRANT_WINDOW_WARN_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export interface GrantWindowWarnGate {
  shouldWarn(tradeNo: string): boolean;
  size(): number;
}

export function createGrantWindowWarnGate(
  cooldownMs: number = GRANT_WINDOW_WARN_COOLDOWN_MS,
): GrantWindowWarnGate {
  const lastWarnAt = new Map<string, number>();
  return {
    shouldWarn(tradeNo) {
      const now = Date.now();
      for (const [key, at] of lastWarnAt) {
        if (now - at >= cooldownMs) lastWarnAt.delete(key);
      }
      if (lastWarnAt.has(tradeNo)) return false;
      lastWarnAt.set(tradeNo, now);
      return true;
    },
    size() {
      return lastWarnAt.size;
    },
  };
}
