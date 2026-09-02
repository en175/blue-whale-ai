/**
 * X-Trace-Id 跨系统链路标识（IK6KQQ，父任务 IK6KO2）。
 *
 * 设计对齐 blue-whale-api ADR-0002：
 * - 透传优先：入口请求已带 X-Trace-Id 则原样沿用，同一链路不重生成；
 * - 缺省生成：最外层入口未带时生成「时间戳-随机串」；
 * - 异步传播：基于 AsyncLocalStorage，trace_id 随异步上下文自动传递。
 */
import { randomBytes } from "node:crypto";

export const TRACE_ID_HEADER = "x-trace-id";

/** AsyncLocalStorage 最小结构（避免静态 import node:async_hooks）。 */
interface TraceStore {
  run<T>(traceId: string, fn: () => T): T;
  getStore(): string | undefined;
}

const noopStore: TraceStore = {
  run: (_traceId, fn) => fn(),
  getStore: () => undefined,
};

/**
 * 服务端首次调用时经 process.getBuiltinModule 装配 AsyncLocalStorage；
 * 浏览器端恒返回空实现。不用静态 import node:async_hooks，
 * 保证本模块经主 barrel 进入浏览器 chunk 时不因 Node 专有模块构建失败
 * （Turbopack 浏览器 chunk 不支持 external node:async_hooks，IK67HH T16）。
 */
function resolveStore(): TraceStore {
  if (
    typeof process === "undefined" ||
    typeof process.versions?.node !== "string"
  ) {
    return noopStore;
  }
  const builtin = (
    process as { getBuiltinModule?: (id: string) => unknown }
  ).getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage: new <T>(...args: T[]) => TraceStore }
    | undefined;
  return builtin ? new builtin.AsyncLocalStorage<string>() : noopStore;
}

const traceStore = resolveStore();

/** 当前异步上下文中的 trace_id；无上下文时返回 null。 */
export function getCurrentTraceId(): string | null {
  return traceStore.getStore() ?? null;
}

/** 在指定 trace_id 的上下文中执行 fn（透传优先由调用方决定）。 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  return traceStore.run(traceId, fn);
}

/**
 * 入站 trace id 的合法形状（D6）。
 *
 * X-Trace-Id 是客户端可控输入。旧规则是「长度 ≤256 的可见 ASCII」——空格、引号、路径全部
 * 放行，而这是每一条跨服务查询的键。不合规不代表丢线索：本服务另生成一个，原值另记入
 * client_trace_id。
 *
 * 三个仓逐字相同的表达式；只改这里会重新造出它替掉的那种分歧。
 */
export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** W3C Trace Context：`00-<32位hex>-<16位hex>-<flags>`，只取 trace-id 段。 */
const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export const TRACEPARENT_HEADER = "traceparent";

/** resolveTraceId 的结论，让调用方能把被拒的原值记下来而不是丢掉。 */
export interface ResolvedTraceId {
  traceId: string;
  /** 入站值被拒时的原值；沿用或根本没发时不存在。 */
  clientTraceId?: string;
}

/**
 * 透传优先、缺省生成，被拒的原值一并带回（D6）。
 *
 * 顺序是 X-Trace-Id、traceparent、生成。X-Trace-Id 发了但不合规不会落到 traceparent：
 * 两个头都发、第一个写错的调用方，应该看到一个明确是新生成的 id，而不是被悄悄换到另一条链上。
 */
export function resolveTraceId(
  headerValue?: string | null,
  traceparent?: string | null,
): ResolvedTraceId {
  const candidate = typeof headerValue === "string" ? headerValue.trim() : "";
  if (candidate) {
    if (TRACE_ID_PATTERN.test(candidate)) return { traceId: candidate };
    return { traceId: generateTraceId(), clientTraceId: candidate };
  }
  const parent =
    typeof traceparent === "string" ? TRACEPARENT_PATTERN.exec(traceparent.trim()) : null;
  if (parent) return { traceId: parent[1]! };
  return { traceId: generateTraceId() };
}

/**
 * 生成缺省 trace_id：毫秒时间戳 + 8 字节随机 hex。三仓同一形状，且本身满足
 * {@link TRACE_ID_PATTERN}——自己生成的值过不了自己的校验，是这类改动最容易犯又最难发现的错。
 */
export function generateTraceId(): string {
  return `${Date.now()}-${randomBytes(8).toString("hex")}`;
}
