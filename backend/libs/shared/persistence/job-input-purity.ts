
export type PureData<T> = {
  readonly [K in keyof T]: NonNullable<T[K]> extends (
    ...args: never[]
  ) => unknown
    ? never
    : T[K];
};

function findUnserializable(
  value: unknown,
  path: string,
  ancestors: Set<unknown>,
): string | null {
  const kind = typeof value;
  if (kind === "function" || kind === "symbol" || kind === "bigint") {
    return path;
  }
  if (value === null || kind !== "object") return null;
  if (ancestors.has(value)) return path;
  ancestors.add(value);
  const children: Array<[string, unknown]> = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  let found: string | null = null;
  for (const [key, item] of children) {
    found = findUnserializable(item, `${path}.${key}`, ancestors);
    if (found !== null) break;
  }
  ancestors.delete(value);
  return found;
}

export class UnserializableJobInputError extends Error {
  constructor(public readonly path: string) {
    super(`生成任务入参含不可序列化的值（${path}）：它会被原样写进日志载荷`);
    this.name = "UnserializableJobInputError";
  }
}

export function assertPureJobInput<T extends PureData<T>>(input: T): void {
  const offender = findUnserializable(input, "input", new Set());
  if (offender !== null) throw new UnserializableJobInputError(offender);
}
