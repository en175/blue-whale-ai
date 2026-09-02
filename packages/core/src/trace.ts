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

/**
 * 服务端把请求头里的 socket 对端地址放在这个头上（IKB29O）。
 *
 * Express 有 `req.socket.remoteAddress`，但 trace 中间件之外的调用点拿不到 req；而工单要的是
 * 「错误场景能看到是哪个 IP 出的问题」，那意味着**任意一行**日志都得带得上，不是只有入口那行。
 * 所以地址和 trace_id 一样进 ALS。这个常量给 agent 侧的同名约定留一个对得上的名字。
 */
export const PEER_ADDRESS_HEADER = "x-agent-peer-address";

/**
 * 一个请求里每一行日志都能报出来的东西（IKB29O）。
 *
 * 此前只有 trace_id。加地址不是为了访问日志那一行——那一行本来就能自己读 req；是为了**别的**
 * 那些行，因为出问题的从来不是你预先标注好的那一行。
 */
export interface RequestContext {
  traceId: string;
  /** OTel client.address —— X-Forwarded-For 首项，客户端可控，按用户输入校验。 */
  clientAddress: string;
  /** OTel network.peer.address —— 真正开了 socket 的那一端，伪造不了。 */
  peerAddress: string;
}

/** AsyncLocalStorage 最小结构（避免静态 import node:async_hooks）。 */
interface TraceStore {
  run<T>(context: RequestContext, fn: () => T): T;
  getStore(): RequestContext | undefined;
}

const noopStore: TraceStore = {
  run: (_context, fn) => fn(),
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
    { AsyncLocalStorage: new <T>(...args: T[]) => TraceStore } | undefined;
  return builtin ? new builtin.AsyncLocalStorage<RequestContext>() : noopStore;
}

const traceStore = resolveStore();

/** 当前异步上下文中的 trace_id；无上下文时返回 null。 */
export function getCurrentTraceId(): string | null {
  return traceStore.getStore()?.traceId ?? null;
}

/** 完整的请求上下文；请求之外（定时任务、启动、worker 空转）为 null。 */
export function getCurrentRequestContext(): RequestContext | null {
  return traceStore.getStore() ?? null;
}

/**
 * 在指定 trace_id 的上下文中执行 fn（透传优先由调用方决定）。
 *
 * 已有地址时**继承**而不是清空：这个函数在离入口很远的地方也会被调用（worker 领到一条消息、
 * 重放一个请求），把地址抹掉的那一行，恰恰最可能是出错的那一行。
 */
export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  const inherited = traceStore.getStore();
  return traceStore.run(
    { clientAddress: "", peerAddress: "", ...inherited, traceId },
    fn,
  );
}

/** 在完整上下文中执行 fn。入口中间件用它；其它地方用 runWithTraceId。 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return traceStore.run(context, fn);
}

/**
 * 地址转成日志字段，取不到就**不写**这个键。
 *
 * 不写空串：后台任务本来就没有地址，写成空串会让人以为是采集失败。查
 * `client_address: *` 得到的应当恰好是请求产生的那些行。
 */
export function requestAddressFields(
  context: RequestContext | null,
): Record<string, string> {
  if (!context) return {};
  const fields: Record<string, string> = {};
  if (context.clientAddress) fields.client_address = context.clientAddress;
  if (context.peerAddress) fields.network_peer_address = context.peerAddress;
  return fields;
}

/** Node 在双栈 socket 上把 IPv4 报成 `::ffff:10.0.0.1`，剥掉前缀。 */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;

/**
 * 一个地址串清洗成能写进日志的值，不合形状就丢掉。
 *
 * X-Forwarded-For 是客户端可控的列表：只取首项、限长、必须是 IPv4/IPv6 字面量。丢掉而不是
 * 原样写进去——一个人读到 `client_address` 时会当它是事实。伪造的 XFF 只能添一个声称，
 * 抹不掉 peerAddress 记下的连接事实，两者并存正是为此。
 */
export function sanitizeAddress(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 45) return "";
  const mapped = IPV4_MAPPED.exec(text);
  const candidate = mapped ? mapped[1]! : text;
  if (IPV4.test(candidate) || IPV6.test(candidate)) return candidate;
  return "";
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
    typeof traceparent === "string"
      ? TRACEPARENT_PATTERN.exec(traceparent.trim())
      : null;
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
