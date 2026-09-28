/**
 * 建 job 的对象**只允许纯数据** —— 它在落库那一刻同时是 Prisma 的 `create` 入参和
 * `generation_job_logs.payload` 的载荷，混进行为必然在落库时炸（函数序列化不了 → 日志插入
 * 抛错 → 事务回滚 → 500），而 billing 那边的冻结已经发生。实测踩过这个坑。
 *
 * 类型侧：{@link PureData} 把纪律变成编译错误（加一个回调属性就编不过），不靠「这次记得别加」。
 * 运行时侧：`input` 是任意 JSON 快照（`Record<string, unknown>`），类型看不穿它内部，
 * 所以再深扫一遍兜住那个角落。
 */

/** 把函数属性映射成 `never`：目标类型上只要再长出回调，{@link assertPureJobInput} 就**编不过**
 *  （`never` 不可赋值 ⇒ 约束不成立）。
 *
 *  ⚠️ 判定前先 `NonNullable`：可选属性（`f?: () => void`）在条件类型里会连同 `undefined`
 *     一起分发，直接写 `T[K] extends …` 会让它**悄悄漏过去** —— 而实测那个 bug 正是可选
 *     的回调（`billingHold?: (jobId) => Promise<void>`）。可选性本身照旧保留（合法的可选
 *     标量不受影响：`source?: string` 仍通过）。 */
export type PureData<T> = {
  readonly [K in keyof T]: NonNullable<T[K]> extends (
    ...args: never[]
  ) => unknown
    ? never
    : T[K];
};

/** 挑出「序列化不了的值」：函数/符号/大整数超出 JSON 的数据模型，环则让序列化直接抛错。
 *  `ancestors` 是当前 DFS 路径上的对象（不是「见过的全部」）——同一个对象被两处引用是合法的，
 *  只有真的绕回自己才是环。返回值的路径形如 `input.references.0.url`。 */
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

/** 违例时抛出（由调用方翻成响应）。返回的不是校验结果而是**第一个违例的路径**，
 *  便于从那行日志直接定位是哪一层混进了行为。 */
export class UnserializableJobInputError extends Error {
  constructor(public readonly path: string) {
    super(`生成任务入参含不可序列化的值（${path}）：它会被原样写进日志载荷`);
    this.name = "UnserializableJobInputError";
  }
}

/** ★ 闸门本体：违例即抛 {@link UnserializableJobInputError}。
 *
 *  ⚠️ 调用点刻意在**预扣之前**：违例时钱还没动，失败不留「没有对应任务的冻结」。 */
export function assertPureJobInput<T extends PureData<T>>(input: T): void {
  const offender = findUnserializable(input, "input", new Set());
  if (offender !== null) throw new UnserializableJobInputError(offender);
}
