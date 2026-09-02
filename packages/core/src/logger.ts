/**
 * 结构化日志（IK6KQQ，父任务 IK6KO2；字段名见 IKB29O 决策 D2）。
 *
 * 字段：{severity_text, timestamp, service_name, service_instance_id,
 * deployment_environment_name, service_version, trace_id, code_file_path, code_line_number,
 * code_function_name, body}。名字对齐 OpenTelemetry 语义约定，点号平铺为下划线——火山 TLS
 * 对点号键索引支持不佳。平铺后已不是 OTel 能识别的属性名：这次对齐买到的是三仓只有一种叫法，
 * 以及将来接 OTel 后端时字段能直接对上，不是今天的互操作性。
 *
 * trace_id 自动取自 AsyncLocalStorage 链路上下文（见 trace.ts）。
 * 输出：JSON 行进 stdout/stderr，同时异步上报火山 TLS（配置不全则跳过）。
 * 日志通道永不抛错、不阻断业务。
 */
// 流水线触发器测试：无功能改动。
import { hostname } from "node:os";

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
  /** OTel SeverityText，小写 debug/info/warn/error */
  severity_text: LogLevel;
  /** OTel Timestamp，ISO8601 带毫秒带时区 */
  timestamp: string;
  /** OTel service.name（CONTAINER_NAME 或 createLogger 的 name） */
  service_name: string;
  /** OTel service.instance.id，回答「哪个副本报的错」（SERVICE_INSTANCE_ID，缺省 主机名-PID） */
  service_instance_id: string;
  /** OTel deployment.environment.name（APP_ENV > NODE_ENV，缺省 local） */
  deployment_environment_name: string;
  /** OTel service.version（APP_VERSION，缺省 unknown） */
  service_version: string;
  /** 链路标识（无上下文为空串） */
  trace_id: string;
  /** OTel code.file.path */
  code_file_path: string;
  /** OTel code.line.number。自成一个字段，不和路径粘在一起——粘着既过滤不了也排序不了 */
  code_line_number: number;
  /** OTel code.function.name */
  code_function_name: string;
  /** OTel Body */
  body: string;
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

/** 提取调用点（跳过 logger 自身帧）。路径与行号分开返回，见 D2。 */
function captureCallSite(): {
  code_function_name: string;
  code_file_path: string;
  code_line_number: number;
} {
  const stack = new Error().stack?.split("\n") ?? [];
  for (const line of stack.slice(1)) {
    if (line.includes("logger.ts") || line.includes("logger.js")) continue;
    const at = line.indexOf("at ");
    const body = at >= 0 ? line.slice(at + 3).trim() : line.trim();
    const match = /\(?([^()\s]+):(\d+):\d+\)?$/.exec(body);
    const funcMatch = /^(.*?)\s+\(?[^()\s]+:\d+:\d+\)?$/.exec(body);
    return {
      code_function_name:
        funcMatch?.[1] && funcMatch[1] !== "Object.<anonymous>" ? funcMatch[1] : "anonymous",
      code_file_path: match ? relativeCallerPath(match[1]!) : "unknown",
      code_line_number: match ? Number(match[2]) : 0,
    };
  }
  return { code_function_name: "anonymous", code_file_path: "unknown", code_line_number: 0 };
}

/**
 * `packages/core/src/logger.ts` 而不是构建机上的绝对路径。
 *
 * 绝对路径说的是构建机而不是文件：容器里是 /app/dist/…，开发机上是各自的检出路径，两者
 * 比不了，同一份代码在不同副本上写出不同的值。截到 packages/ / backend/ / src/ / dist/ 之后，
 * 三个仓的这个字段才是同一种东西——agent 侧同样这么做。
 */
function relativeCallerPath(file: string): string {
  const cleaned = file.replace(/^file:\/\//, "");
  const match = /(?:^|\/)((?:packages|backend|src|dist)\/.*)$/.exec(cleaned);
  return match?.[1] ?? cleaned;
}

/**
 * 创建结构化 logger。
 *
 * 取值一律用 `||` 而不是 `??`：`??` 只在 null/undefined 时兜底，于是 `CONTAINER_NAME=""`
 * 会让 service_name 变成空串而不是回退到 name。Go 侧判的是 `== ""`，本来就没这个洞——
 * 这正是 IKB29O 决策点名的那个实现缺陷。
 */
export function createLogger(name: string, options: CreateLoggerOptions = {}): Logger {
  const envSource = options.envSource ?? process.env;
  const serviceName = options.container || envSource.CONTAINER_NAME?.trim() || name;
  const instanceId =
    envSource.SERVICE_INSTANCE_ID?.trim() || `${hostname()}-${process.pid}`;
  const environment =
    options.env || envSource.APP_ENV?.trim() || envSource.NODE_ENV?.trim() || "local";
  const serviceVersion = options.version || envSource.APP_VERSION?.trim() || "unknown";
  const writer = options.writer ?? getDefaultTlsLogWriter();

  const RESERVED_KEYS = new Set([
    "severity_text",
    "timestamp",
    "service_name",
    "service_instance_id",
    "deployment_environment_name",
    "service_version",
    "trace_id",
    "code_file_path",
    "code_line_number",
    "code_function_name",
    "body",
  ]);

  function write(level: LogLevel, message: string, extras?: Record<string, string | number>): void {
    const callSite = captureCallSite();
    const record: Record<string, string | number> = {
      severity_text: level,
      timestamp: new Date().toISOString(),
      service_name: serviceName,
      service_instance_id: instanceId,
      deployment_environment_name: environment,
      service_version: serviceVersion,
      trace_id: getCurrentTraceId() ?? "",
      ...callSite,
      body: message,
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
