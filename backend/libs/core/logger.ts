import { hostname, networkInterfaces } from "node:os";

import { wallClockMillis } from "./wall-clock.js";
import { redactLogBody, redactLogValue } from "./redact.js";
import { getCurrentRequestContext, requestAddressFields } from "./trace.js";
import { getDefaultTlsLogWriter, type TlsLogWriter } from "./tls-writer.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type MetricResult = "ok" | "fail";

export interface MetricEventInput {
  event: string;
  result?: MetricResult;
  duration_ms?: number;
  fields?: Record<string, string | number>;
}

export interface LogRecord {
  severity_text: LogLevel;
  timestamp: string;
  service_name: string;
  service_instance_id: string;
  host_ip: string;
  deployment_environment_name: string;
  service_version: string;
  trace_id: string;
  code_file_path: string;
  code_line_number: number;
  code_function_name: string;
  body: string;
}

export type LogExtras = Record<string, string | number>;

export interface Logger {
  name: string;
  debug(message: string, extras?: LogExtras): void;
  info(message: string, extras?: LogExtras): void;
  warn(message: string, extras?: LogExtras): void;
  error(message: string, extras?: LogExtras): void;
  metric(input: MetricEventInput): void;
}

export interface CreateLoggerOptions {
  writer?: TlsLogWriter;
  envSource?: NodeJS.ProcessEnv;
}

export function toBlueWhaleTimestamp(epochMs: number): string {
  return wallClockMillis(new Date(epochMs));
}

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

function relativeCallerPath(file: string): string {
  const cleaned = file.replace(/^file:\/\//, "").replace(/\\/g, "/");
  const match = /(?:^|\/)((?:packages|backend|src|dist)\/.*)$/.exec(cleaned);
  return match?.[1] ?? cleaned;
}

let logServiceName = "blue-whale-backend";

export function setLogServiceName(name: string): void {
  logServiceName = name;
}

export const LOG_SERVICE_VERSION = "0.1.0";

function processIdentity(envSource: NodeJS.ProcessEnv) {
  return {
    service_name: logServiceName,
    service_instance_id: `${hostname()}-${process.pid}`,
    host_ip: firstNonLoopbackAddress(),
    deployment_environment_name: envSource.NODE_ENV?.trim() || "production",
    service_version: LOG_SERVICE_VERSION,
  };
}

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
      ...requestAddressFields(request),
      body: redactLogBody(message),
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
