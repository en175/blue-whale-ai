
function textOf(sql: string, key: string): string | null {
  const m = sql.match(new RegExp(`'${key}',\\s*'([^']*)'`));
  return m?.[1] ?? null;
}

function numberOf(sql: string, key: string): number | null {
  const m = sql.match(new RegExp(`'${key}',\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

export function audioRuleOf(sql: string) {
  return {
    baseUnit: textOf(sql, "baseUnit"),
    basePrice: { kind: textOf(sql, "kind"), value: numberOf(sql, "value") },
    unitDenominator: numberOf(sql, "unitDenominator"),
    minCredits: numberOf(sql, "minCredits"),
    maxCredits: numberOf(sql, "maxCredits"),
  };
}
