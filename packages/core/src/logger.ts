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

export type MetricResult = "ok" | "fail";

/** 结构化指标事件输入（IK7G9Y）：event/result/duration_ms 为约定字段，fields 自定义扩展。 */
export interface MetricEventInput {
  /** 事件名：task_finished / provider_call / queue_depth */
  event: string;
  result?: MetricResult;
  /** 耗时（毫秒） */
  duration_ms?: number;
  /** 自定义字段（snake_case），如 job_type / provider / operation / queue / status / depth；同名不覆盖基础字段。 */
  fields?: Record<string, string | number>;
}

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
  /** 结构化指标事件（IK7G9Y）：info 级 JSON 行，约定字段落顶层，供 TLS 侧聚合告警。 */
  metric(input: MetricEventInput): void;
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

  const RESERVED_KEYS = new Set([
    "level",
    "time",
    "container",
    "env",
    "version",
    "trace_id",
    "caller",
    "func",
    "message",
  ]);

  function write(level: LogLevel, message: string, extras?: Record<string, string | number>): void {
    const { func, caller } = captureCallSite();
    const record: Record<string, string | number> = {
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
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        if (!RESERVED_KEYS.has(key)) record[key] = value;
      }
    }
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

  function metric(input: MetricEventInput): void {
    const extras: Record<string, string | number> = { event: input.event };
    if (input.result !== undefined) extras.result = input.result;
    if (input.duration_ms !== undefined) extras.duration_ms = input.duration_ms;
    const METRIC_KEYS = new Set(["event", "result", "duration_ms"]);
    for (const [key, value] of Object.entries(input.fields ?? {})) {
      if (!METRIC_KEYS.has(key)) extras[key] = value;
    }
    const summary = Object.entries(extras)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    write("info", `metric ${summary}`, extras);
  }

  return {
    name,
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
    metric,
  };
}
