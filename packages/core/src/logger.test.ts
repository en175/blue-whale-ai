import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger.js";
import { runWithTraceId } from "./trace.js";
import type { TlsLogRecord, TlsLogWriter } from "./tls-writer.js";

function fakeWriter(): { writer: TlsLogWriter; records: TlsLogRecord[] } {
  const records: TlsLogRecord[] = [];
  return {
    records,
    writer: {
      write: (record) => records.push(record),
      close: async () => {},
    },
  };
}

const QUIET = {
  envSource: {} as NodeJS.ProcessEnv,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createLogger —— 结构化字段", () => {
  it("输出 JSON 行包含全部约定字段", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer, records } = fakeWriter();
    const logger = createLogger("unit-svc", {
      ...QUIET,
      container: "unit-container",
      env: "test",
      version: "1.2.3",
      writer,
    });

    logger.info("hello tls");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      level: "info",
      container: "unit-container",
      env: "test",
      version: "1.2.3",
      trace_id: "",
      message: "hello tls",
    });
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.caller).toContain("logger.test.ts");
    expect(typeof parsed.func).toBe("string");
    expect(records).toHaveLength(1);
    const keys = records[0]!.contents.map((c) => c.Key);
    for (const key of ["level", "time", "container", "env", "version", "trace_id", "caller", "func", "message"]) {
      expect(keys).toContain(key);
    }
    spy.mockRestore();
  });

  it("trace 上下文内 trace_id 自动沿用", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer, records } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    runWithTraceId("trace-abc", () => logger.info("with trace"));

    const traceContent = records[0]!.contents.find((c) => c.Key === "trace_id");
    expect(traceContent?.Value).toBe("trace-abc");
  });

  it("error 走 stderr 通道，warn 走 console.warn", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.error("boom");
    logger.warn("careful");

    expect(JSON.parse(String(errorSpy.mock.calls[0]![0])).level).toBe("error");
    expect(JSON.parse(String(warnSpy.mock.calls[0]![0])).level).toBe("warn");
  });

  it("TLS writer 抛错时日志主通道不受影响", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("unit-svc", {
      ...QUIET,
      writer: {
        write: () => {
          throw new Error("tls down");
        },
        close: async () => {},
      },
    });
    expect(() => logger.info("still ok")).not.toThrow();
  });
});

describe("createLogger —— 结构化 metric 事件（IK7G9Y）", () => {
  it("metric 输出 event/result/duration_ms 与自定义字段到 stdout 与 TLS writer", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer, records } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.metric({
      event: "provider_call",
      result: "ok",
      duration_ms: 123,
      fields: { provider: "new_api_video", operation: "submit" },
    });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      level: "info",
      event: "provider_call",
      result: "ok",
      duration_ms: 123,
      provider: "new_api_video",
      operation: "submit",
    });
    expect(parsed.message).toContain("event=provider_call");
    const keys = records[0]!.contents.map((c) => c.Key);
    for (const key of ["event", "result", "duration_ms", "provider", "operation"]) {
      expect(keys).toContain(key);
    }
    logSpy.mockRestore();
  });

  it("metric 自定义字段同名不覆盖基础字段", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.metric({ event: "task_finished", fields: { level: "hack", message: "hack" } });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed.level).toBe("info");
    expect(parsed.message).toContain("event=task_finished");
    expect(parsed.message).not.toBe("hack");
    logSpy.mockRestore();
  });

  it("metric 自定义字段不覆盖 event/result/duration_ms 约定字段", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.metric({
      event: "provider_call",
      result: "ok",
      duration_ms: 50,
      fields: { event: "hack", result: "fail", duration_ms: 9999, provider: "p" },
    });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      event: "provider_call",
      result: "ok",
      duration_ms: 50,
      provider: "p",
    });
    logSpy.mockRestore();
  });

  it("queue_depth 类纯计数事件可省略 result/duration_ms", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.metric({
      event: "queue_depth",
      fields: { queue: "agent_runs", status: "running", depth: 4 },
    });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      event: "queue_depth",
      queue: "agent_runs",
      status: "running",
      depth: 4,
    });
    expect("result" in parsed).toBe(false);
    expect("duration_ms" in parsed).toBe(false);
    logSpy.mockRestore();
  });
});
