import { randomBytes } from "node:crypto";

export const TRACE_ID_HEADER = "x-trace-id";

export const PEER_ADDRESS_HEADER = "x-agent-peer-address";

export interface RequestContext {
  traceId: string;
  clientAddress: string;
  peerAddress: string;
}

interface TraceStore {
  run<T>(context: RequestContext, fn: () => T): T;
  getStore(): RequestContext | undefined;
}

const noopStore: TraceStore = {
  run: (_context, fn) => fn(),
  getStore: () => undefined,
};

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

export function getCurrentTraceId(): string | null {
  return traceStore.getStore()?.traceId ?? null;
}

export function getCurrentRequestContext(): RequestContext | null {
  return traceStore.getStore() ?? null;
}

export function runWithTraceId<T>(traceId: string, fn: () => T): T {
  const inherited = traceStore.getStore();
  return traceStore.run(
    { clientAddress: "", peerAddress: "", ...inherited, traceId },
    fn,
  );
}

export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return traceStore.run(context, fn);
}

export function requestAddressFields(
  context: RequestContext | null,
): Record<string, string> {
  if (!context) return {};
  const fields: Record<string, string> = {};
  if (context.clientAddress) fields.client_address = context.clientAddress;
  if (context.peerAddress) fields.network_peer_address = context.peerAddress;
  return fields;
}

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]{2,45}$/i;

export function sanitizeAddress(value: string | null | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 45) return "";
  const mapped = IPV4_MAPPED.exec(text);
  const candidate = mapped ? mapped[1]! : text;
  if (IPV4.test(candidate) || IPV6.test(candidate)) return candidate;
  return "";
}

export const TRACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export const TRACEPARENT_HEADER = "traceparent";

export interface ResolvedTraceId {
  traceId: string;
  clientTraceId?: string;
}

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

export function generateTraceId(): string {
  return `${Date.now()}-${randomBytes(8).toString("hex")}`;
}
