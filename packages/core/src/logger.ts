/**
 * 结构化日志（IK6KQQ，父任务 IK6KO2 / ADR-0002 D4）。
 *
 * 字段：{level, time, container, env, version, trace_id, caller, func, message}。
 * trace_id 自动取自 AsyncLocalStorage 链路上下文（见 trace.ts）。
 * 输出：JSON 行进 stdout/stderr，同时异步上报火山 TLS（配置不全则跳过）。
 * 日志通道永不抛错、不阻断业务。
 */
// 流水线触发器测试：无功能改动。
import { getCurrentTraceId } from "./trace.js";
import { getDefaultTlsLogWriter, type TlsLogWriter } from "./tls-writer.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** 单条结构化日志记录（字段与 TLS 索引字段对齐）。 */
export interface LogRecord {
  level: LogLevel;
  /** ISO8601 时间 */
  time: string;
  /** 容器/服务名（CONTAINER_NAME 或 createLogger 的 name） */
  container: string;
  /** 部署环境（APP_ENV > NODE_ENV，缺省 local） */
  env: string;
  /** 构建版本（APP_VERSION，缺省 unknown） */
  version: string;
  /** 链路标识（无上下文为空串） */
  trace_id: string;
  /** 调用点 file:line */
  caller: string;
  /** 调用函数名 */
  func: string;
  message: string;
}

export interface Logger {
  name: string;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface CreateLoggerOptions {
  container?: string;
  env?: string;
  version?: string;
  /** 默认走进程级 TLS writer（按 TLS_* 环境变量惰性初始化）。 */
  writer?: TlsLogWriter;
  envSource?: NodeJS.ProcessEnv;
}

/** 提取调用点（跳过 logger 自身帧）：{func, caller=file:line}。 */
function captureCallSite(): { func: string; caller: string } {
  const stack = new Error().stack?.split("\n") ?? [];
  for (const line of stack.slice(1)) {
    if (line.includes("logger.ts") || line.includes("logger.js")) continue;
    const at = line.indexOf("at ");
    const body = at >= 0 ? line.slice(at + 3).trim() : line.trim();
    const match = /\(?([^()\s]+):(\d+):\d+\)?$/.exec(body);
    const funcMatch = /^(.*?)\s+\(?[^()\s]+:\d+:\d+\)?$/.exec(body);
    return {
      func: funcMatch?.[1] && funcMatch[1] !== "Object.<anonymous>" ? funcMatch[1] : "anonymous",
      caller: match ? `${match[1]}:${match[2]}` : "unknown",
    };
  }
  return { func: "anonymous", caller: "unknown" };
}

/** 创建结构化 logger。container 缺省取 CONTAINER_NAME 环境变量或 name。 */
export function createLogger(name: string, options: CreateLoggerOptions = {}): Logger {
  const envSource = options.envSource ?? process.env;
  const container =
    options.container ?? envSource.CONTAINER_NAME?.trim() ?? name;
  const env = options.env ?? envSource.APP_ENV?.trim() ?? envSource.NODE_ENV?.trim() ?? "local";
  const version = options.version ?? envSource.APP_VERSION?.trim() ?? "unknown";
  const writer = options.writer ?? getDefaultTlsLogWriter();

  function emit(level: LogLevel, message: string): void {
    const { func, caller } = captureCallSite();
    const record: LogRecord = {
      level,
      time: new Date().toISOString(),
      container,
      env,
      version,
      trace_id: getCurrentTraceId() ?? "",
      caller,
      func,
      message,
    };
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    try {
      writer.write({
        time: Date.now(),
        contents: Object.entries(record).map(([Key, Value]) => ({ Key, Value: String(Value) })),
      });
    } catch {
      // TLS 上报失败不影响日志主通道。
    }
  }

  return {
    name,
    debug: (message) => emit("debug", message),
    info: (message) => emit("info", message),
    warn: (message) => emit("warn", message),
    error: (message) => emit("error", message),
  };
}
