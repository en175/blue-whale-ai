export type WireInteger = number | string;

export function isWireInteger(value: unknown): value is WireInteger {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^[0-9]+$/.test(value))
  );
}

export function compareWireIntegers(
  left: WireInteger,
  right: WireInteger,
): number {
  const leftBigInt = BigInt(left);
  const rightBigInt = BigInt(right);
  return leftBigInt < rightBigInt ? -1 : leftBigInt > rightBigInt ? 1 : 0;
}

export function wireIntegersEqual(
  left: WireInteger,
  right: WireInteger,
): boolean {
  return compareWireIntegers(left, right) === 0;
}

export function wireInteger(value: string): WireInteger {
  return BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value;
}

export function wireNullableInteger(value: string | null): WireInteger | null {
  return value === null ? null : wireInteger(value);
}
