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
 * 透传优先、缺省生成：
 * headerValue 非空（trim 后为合法可见 ASCII、长度 ≤256）时原样沿用，
 * 否则生成「毫秒时间戳-随机hex」。
 */
export function getOrCreateTraceId(headerValue?: string | null): string {
  const candidate = typeof headerValue === "string" ? headerValue.trim() : "";
  if (candidate.length > 0 && candidate.length <= 256 && /^[\x20-\x7e]+$/.test(candidate)) {
    return candidate;
  }
  return generateTraceId();
}

/** 生成缺省 trace_id：毫秒时间戳 + 8 字节随机 hex。 */
export function generateTraceId(): string {
  return `${Date.now()}-${randomBytes(8).toString("hex")}`;
}
