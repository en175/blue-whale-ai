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
import { hostname, networkInterfaces } from "node:os";

import { redactLogBody, redactLogValue } from "./redact.js";
import { getCurrentRequestContext, requestAddressFields } from "./trace.js";
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
  /** OTel Timestamp，ISO8601 带毫秒，恒为 +08:00。见 toBlueWhaleTimestamp */
  timestamp: string;
  /** OTel service.name，进程级常量，由 setLogServiceName 声明。不是配置 */
  service_name: string;
  /** OTel service.instance.id，回答「哪个副本报的错」。主机名-PID；容器里主机名就是容器 id */
  service_instance_id: string;
  /**
   * OTel host.ip，回答「哪个 IP 报的错」。
   *
   * service_instance_id 在 k8s 里的主机名那一半是 Pod 名——有用，但跟抓包、防火墙日志对不起来。
   * 扫第一块非环回网卡得出，容器里拿到的就是容器自己的地址。
   */
  host_ip: string;
  /** OTel deployment.environment.name（NODE_ENV，没给写 unknown）。六个字段里唯一要外面给的 */
  deployment_environment_name: string;
  /** OTel service.version —— LOG_SERVICE_VERSION，本仓自己的版本 */
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

/** 随一行日志附带的结构化字段。同名不覆盖基础字段。 */
export type LogExtras = Record<string, string | number>;

export interface Logger {
  name: string;
  debug(message: string, extras?: LogExtras): void;
  info(message: string, extras?: LogExtras): void;
  warn(message: string, extras?: LogExtras): void;
  error(message: string, extras?: LogExtras): void;
  /** 结构化指标事件（IK7G9Y）：info 级 JSON 行，约定字段落顶层，供 TLS 侧聚合告警。 */
  metric(input: MetricEventInput): void;
}

export interface CreateLoggerOptions {
  /** 默认走进程级 TLS writer（按 TLS_* 环境变量惰性初始化）。 */
  writer?: TlsLogWriter;
  envSource?: NodeJS.ProcessEnv;
}

/**
 * `2026-09-02T17:05:09.123+08:00` —— 三仓共用的那一个墙上时钟。
 *
 * **固定偏移，由时间戳算出，不读 TZ、不读宿主机。**这个区别就是它的安全性所在：跨服务按字符串
 * 排序只在三家偏移**完全一致**时成立，而从容器配置推导出来的值，离「某个容器没配 TZ、于是退回
 * UTC」只有一步——那正是它替掉的那个 bug（Go 写 +08:00、Node 写 Z，+08:00 排在 Z 后面尽管
 * 实际更早）。写死之后，+08:00 和原来的 Z 一样确定。
 *
 * 选 +08:00 而不是 UTC：看日志的人都在这个时区，而心算减八小时最贵的时刻恰好是出故障的时候。
 * 中国不实行夏令时，固定偏移全年成立。
 */
const LOG_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

export function toBlueWhaleTimestamp(epochMs: number): string {
  return `${new Date(epochMs + LOG_TZ_OFFSET_MS).toISOString().slice(0, -1)}+08:00`;
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
        funcMatch?.[1] && funcMatch[1] !== "Object.<anonymous>"
          ? funcMatch[1]
          : "anonymous",
      code_file_path: match ? relativeCallerPath(match[1]!) : "unknown",
      code_line_number: match ? Number(match[2]) : 0,
    };
  }
  return {
    code_function_name: "anonymous",
    code_file_path: "unknown",
    code_line_number: 0,
  };
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
 * 这个进程报出去的 `service_name`，以及它凭什么不是一个环境变量。
 *
 * 曾经是 `CONTAINER_NAME`，缺省回退到 `createLogger` 的那个名字。于是忘配一次——线上就是忘了
 * ——同一个容器里每个模块报一个不同的服务名，实测 bw-backend 自报 `trace-middleware`，那是个
 * 中间件的名字。「按服务过滤日志」这件事因此不成立，而且没有任何一处会红。
 *
 * 现在它是代码里的一个值：本仓有两个可部署单元，各自在 main.ts 里声明一次。缺省是主 API，
 * 因为忘了声明时那是唯一说得通的答案，而不是一个由部署决定的空白。
 *
 * **在写日志的那一刻取值，不是在建 logger 的那一刻。** 各模块的 `createLogger(...)` 是模块
 * 顶层求值的，跑在 main.ts 的函数体之前——建 logger 时取值就意味着声明永远来不及。
 */
let logServiceName = "blue-whale-backend";

export function setLogServiceName(name: string): void {
  logServiceName = name;
}

/**
 * 本仓的版本，镜像自 `packages/core/package.json`。
 *
 * 字面量而不是读文件：产物是 bundle，相对本模块的路径在那里解析不到东西。
 * `logger.test.ts` 会在它和 package.json 不一致时失败，所以镜像不会悄悄漂。
 */
export const LOG_SERVICE_VERSION = "0.1.0";

/**
 * 进程身份：哪个副本、哪个 IP、哪一套部署、哪个版本。
 *
 * **这里没有一个值是配置。** 早先版本读 `CONTAINER_NAME` / `SERVICE_INSTANCE_ID` / `HOST_IP` /
 * `APP_VERSION`，每个都带兜底——等于把日志格式的正确性押在「有人记得每套部署配四个变量」上，
 * 而漏配一个不会报错，只会安静地写出一个看起来很像真的错值。看不出错的字段比没有的字段更坏。
 * 下面每个值都从进程本来就确知的东西里直接得出，没有东西要配，也就没有东西会忘。
 *
 * 唯一的例外是 `deployment_environment_name`：这是哪一套部署，进程内部推不出来，只能从外面
 * 断言。它读 `NODE_ENV`，没有为它发明新变量；没给就写 `unknown`，不写从前那个 `local`——
 * 生产容器里的 `local` 是一句读起来像事实的假话。整个集群现在正处在这个状态：只有 agent
 * 容器设了 NODE_ENV，本服务和 New API 在同一套栈里都自报 local。写 unknown 至少在控制台
 * 里看得见这个洞。
 */
function processIdentity(envSource: NodeJS.ProcessEnv) {
  return {
    service_name: logServiceName,
    service_instance_id: `${hostname()}-${process.pid}`,
    host_ip: firstNonLoopbackAddress(),
    deployment_environment_name: envSource.NODE_ENV?.trim() || "unknown",
    service_version: LOG_SERVICE_VERSION,
  };
}

/** 创建结构化 logger。`name` 是模块名，逐行作为 `logger_name` 带出去，不是服务名。 */
export function createLogger(
  name: string,
  options: CreateLoggerOptions = {},
): Logger {
  const envSource = options.envSource ?? process.env;
  const writer = options.writer ?? getDefaultTlsLogWriter();

  const RESERVED_KEYS = new Set([
    "severity_text",
    "timestamp",
    "service_name",
    "service_instance_id",
    "host_ip",
    "deployment_environment_name",
    "service_version",
    "trace_id",
    "code_file_path",
    "code_line_number",
    "code_function_name",
    "body",
  ]);

  function write(level: LogLevel, message: string, extras?: LogExtras): void {
    const callSite = captureCallSite();
    const request = getCurrentRequestContext();
    const record: Record<string, string | number> = {
      severity_text: level,
      timestamp: toBlueWhaleTimestamp(Date.now()),
      ...processIdentity(envSource),
      trace_id: request?.traceId ?? "",
      ...callSite,
      // 谁发起的这个请求，逐行带——工单要的是「错误场景能看到是哪个 IP」，
      // 而出错的从来不是你预先标注好的那一行。
      ...requestAddressFields(request),
      // 截断与脱敏（D9）在这里，因为这里是所有写日志的路唯一的交汇点。
      body: redactLogBody(message),
      // 哪个模块写的。它曾经跟服务名抢同一个字段并且赢了；现在它有自己的位置，
      // 服务名是常量，两个问题各自有答案。
      logger_name: name,
    };
    if (extras) {
      for (const [key, value] of Object.entries(extras)) {
        if (!RESERVED_KEYS.has(key)) record[key] = redactLogValue(key, value);
      }
    }
    const line = JSON.stringify(record);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    try {
      writer.write({
        time: Date.now(),
        contents: Object.entries(record).map(([Key, Value]) => ({
          Key,
          Value: String(Value),
        })),
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
    debug: (message, extras) => write("debug", message, extras),
    info: (message, extras) => write("info", message, extras),
    warn: (message, extras) => write("warn", message, extras),
    error: (message, extras) => write("error", message, extras),
    metric,
  };
}

/**
 * 本机地址，启动时解析一次。
 *
 * 环回和内部接口跳过——「127.0.0.1」回答不了「哪个节点出的问题」。取不到就是空串，
 * 那是合法状态（没有外部网卡的测试容器），不值得为它报一条错。
 */
function firstNonLoopbackAddress(): string {
  try {
    const entries = Object.values(networkInterfaces()).flatMap(
      (list) => list ?? [],
    );
    const usable = entries.filter((entry) => !entry.internal);
    return (
      usable.find((entry) => entry.family === "IPv4")?.address ??
      usable[0]?.address ??
      ""
    );
  } catch {
    return "";
  }
}
