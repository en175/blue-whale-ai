/**
 * 日志/链路子入口（IK6KQQ）。
 *
 * 从 `@blue-whale/core/logging` 导入，避免主 barrel 把所有消费者
 * 静态绑定到火山 SDK（tls-writer 依赖 @volcengine/openapi）。
 * 仅 worker 等需要结构化日志/TLS 上报的进程入口使用。
 */
export {
  TRACE_ID_HEADER,
  generateTraceId,
  getCurrentTraceId,
  getOrCreateTraceId,
  runWithTraceId,
} from "./trace.js";
export { createLogger, type Logger, type LogLevel, type LogRecord } from "./logger.js";
export {
  closeDefaultTlsLogWriter,
  createTlsLogWriter,
  getDefaultTlsLogWriter,
  loadTlsWriterConfig,
  type TlsLogContent,
  type TlsLogRecord,
  type TlsLogWriter,
  type TlsWriterConfig,
} from "./tls-writer.js";
