export type WireInteger = number | string;

export function wireInteger(value: string): WireInteger {
  return BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value;
}

export function wireNullableInteger(value: string | null): WireInteger | null {
  return value === null ? null : wireInteger(value);
}
