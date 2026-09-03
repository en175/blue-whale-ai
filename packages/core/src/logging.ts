/**
 * 日志/链路子入口（IK6KQQ）。
 *
 * 从 `@blue-whale/core/logging` 导入，避免主 barrel 把所有消费者
 * 静态绑定到火山 SDK（tls-writer 依赖 @volcengine/openapi）。
 * 仅 worker 等需要结构化日志/TLS 上报的进程入口使用。
 */
export {
  PEER_ADDRESS_HEADER,
  TRACE_ID_HEADER,
  generateTraceId,
  getCurrentRequestContext,
  getCurrentTraceId,
  requestAddressFields,
  resolveTraceId,
  sanitizeAddress,
  TRACE_ID_PATTERN,
  TRACEPARENT_HEADER,
  runWithRequestContext,
  runWithTraceId,
  type RequestContext,
} from "./trace.js";
export {
  createLogger,
  setLogServiceName,
  LOG_SERVICE_VERSION,
  type Logger,
  type LogExtras,
  type LogLevel,
  type LogRecord,
  type MetricEventInput,
  type MetricResult,
} from "./logger.js";
export {
  MAX_BODY_CHARS,
  MAX_FIELD_CHARS,
  redactLogBody,
  redactLogValue,
  stripUrlQueries,
} from "./redact.js";
export {
  createQueueDepthSampler,
  type QueueDepthReading,
  type QueueDepthSampler,
  type QueueDepthSamplerOptions,
} from "./queue-depth-sampler.js";
export {
  timedProviderCall,
  type ProviderCallIdentity,
} from "./timed-provider-call.js";
export { metricEventsFrom } from "./metric-test-support.js";
export {
  closeDefaultTlsLogWriter,
  createTlsLogWriter,
  getDefaultTlsLogWriter,
  getTlsWriterStats,
  loadTlsWriterConfig,
  resetTlsWriterStats,
  type TlsLogContent,
  type TlsLogRecord,
  type TlsLogWriter,
  type TlsWriterConfig,
  type TlsWriterStats,
} from "./tls-writer.js";
