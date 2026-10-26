
export type Tier = "free" | "basic" | "pro" | "max";

export const TIERS: readonly Tier[] = ["free", "basic", "pro", "max"];

const RANK: Record<Tier, number> = { free: 0, basic: 1, pro: 2, max: 3 };

export function parseTier(raw: string): Tier | null {
  return (TIERS as readonly string[]).includes(raw) ? (raw as Tier) : null;
}

export interface MembershipPeriod {
  tier: string;
  status: string;
  expiresAt: Date | null;
}

export interface TierResolution {
  tier: Tier;
  unknownTiers: string[];
}

export function resolveTier(periods: readonly MembershipPeriod[], now: Date): TierResolution {
  const nowMs = now.getTime();

  const valid = periods.filter(
    (p) =>
      p.status === "active" &&
      (p.expiresAt === null || p.expiresAt.getTime() > nowMs),
  );

  const unknownTiers: string[] = [];
  let best: Tier = "free";

  for (const period of valid) {
    const tier = parseTier(period.tier);
    if (tier === null) {
      if (!unknownTiers.includes(period.tier)) unknownTiers.push(period.tier);
      continue;
    }
    if (RANK[tier] > RANK[best]) best = tier;
  }

  return { tier: best, unknownTiers };
}
