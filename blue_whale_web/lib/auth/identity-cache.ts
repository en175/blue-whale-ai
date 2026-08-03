export type CachedIdentity = {
  userId: string;
  status: "enabled";
  isAdmin: boolean;
  expiresAt: number;
};

type IdentityToCache = Omit<CachedIdentity, "expiresAt">;

type IdentityCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  now: () => number;
};

export function createIdentityCache({
  ttlMs,
  maxEntries,
  now,
}: IdentityCacheOptions) {
  const entries = new Map<string, CachedIdentity>();

  return {
    get(key: string): CachedIdentity | undefined {
      const identity = entries.get(key);

      if (!identity) {
        return undefined;
      }

      if (now() >= identity.expiresAt) {
        entries.delete(key);
        return undefined;
      }

      entries.delete(key);
      entries.set(key, identity);
      return identity;
    },

    set(key: string, identity: IdentityToCache): void {
      entries.delete(key);
      entries.set(key, {
        userId: identity.userId,
        status: identity.status,
        isAdmin: identity.isAdmin,
        expiresAt: now() + ttlMs,
      });

      while (entries.size > maxEntries) {
        const oldestKey = entries.keys().next().value;

        if (oldestKey === undefined) {
          break;
        }

        entries.delete(oldestKey);
      }
    },

    delete(key: string): void {
      entries.delete(key);
    },

    size(): number {
      return entries.size;
    },
  };
}
