import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LOG_SERVICE_VERSION,
  createLogger,
  setLogServiceName,
  toBlueWhaleTimestamp,
} from "./logger.js";
import { readFileSync } from "node:fs";
import { runWithRequestContext, runWithTraceId } from "./trace.js";
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
      envSource: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
      writer,
    });

    logger.info("hello tls");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      severity_text: "info",
      service_name: "blue-whale-backend",
      logger_name: "unit-svc",
      deployment_environment_name: "test",
      service_version: LOG_SERVICE_VERSION,
      trace_id: "",
      body: "hello tls",
    });
    expect(parsed.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/,
    );
    expect(parsed.code_file_path).toMatch(
      /^backend\/libs\/core\/logger\.test\.ts$/,
    );
    expect(typeof parsed.code_line_number).toBe("number");
    expect(parsed.code_line_number).toBeGreaterThan(0);
    expect(String(parsed.service_instance_id)).toMatch(/.+-\d+$/);
    expect(typeof parsed.code_function_name).toBe("string");
    expect(records).toHaveLength(1);
    const keys = records[0]!.contents.map((c) => c.Key);
    for (const key of [
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
    ]) {
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

    expect(JSON.parse(String(errorSpy.mock.calls[0]![0])).severity_text).toBe(
      "error",
    );
    expect(JSON.parse(String(warnSpy.mock.calls[0]![0])).severity_text).toBe(
      "warn",
    );
  });

  it("服务名是进程级常量，环境变量改不动它", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    createLogger("trace-middleware", {
      envSource: {
        CONTAINER_NAME: "whatever",
        SERVICE_INSTANCE_ID: "pinned",
        HOST_IP: "9.9.9.9",
        APP_VERSION: "ba50dec",
      } as NodeJS.ProcessEnv,
      writer,
    }).info("x");
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed.service_name).toBe("blue-whale-backend");
    expect(parsed.service_instance_id).not.toBe("pinned");
    expect(parsed.host_ip).not.toBe("9.9.9.9");
    expect(parsed.service_version).toBe(LOG_SERVICE_VERSION);
  });

  it("另一个可部署单元用 setLogServiceName 声明自己，写日志那一刻才取值", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("video-worker", { ...QUIET, writer });
    setLogServiceName("blue-whale-generation-worker");
    try {
      logger.info("x");
      expect(JSON.parse(String(logSpy.mock.calls[0]![0])).service_name).toBe(
        "blue-whale-generation-worker",
      );
    } finally {
      setLogServiceName("blue-whale-backend");
    }
  });

  it("service_version 与 package.json 一致，漂了就红", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(LOG_SERVICE_VERSION).toBe(pkg.version);
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
      severity_text: "info",
      event: "provider_call",
      result: "ok",
      duration_ms: 123,
      provider: "new_api_video",
      operation: "submit",
    });
    expect(parsed.body).toContain("event=provider_call");
    const keys = records[0]!.contents.map((c) => c.Key);
    for (const key of [
      "event",
      "result",
      "duration_ms",
      "provider",
      "operation",
    ]) {
      expect(keys).toContain(key);
    }
    logSpy.mockRestore();
  });

  it("metric 自定义字段同名不覆盖基础字段", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });

    logger.metric({
      event: "task_finished",
      fields: { severity_text: "hack", body: "hack" },
    });

    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed.severity_text).toBe("info");
    expect(parsed.body).toContain("event=task_finished");
    expect(parsed.body).not.toBe("hack");
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
      fields: {
        event: "hack",
        result: "fail",
        duration_ms: 9999,
        provider: "p",
      },
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

describe("toBlueWhaleTimestamp —— 与库同一个墙上时钟（IKHJ0Q）", () => {
  it("恒为北京时间 +08:00，带毫秒", () => {
    expect(toBlueWhaleTimestamp(1756800000000)).toBe("2025-09-02T16:00:00.000+08:00");
  });

  it("不随进程时区变化", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "America/New_York", "Asia/Shanghai"]) {
        process.env.TZ = tz;
        expect(toBlueWhaleTimestamp(1756800000000)).toBe(
          "2025-09-02T16:00:00.000+08:00",
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("解析回去与源时刻相等——偏移不是贴上去的假标签", () => {
    expect(Date.parse(toBlueWhaleTimestamp(1756800000000))).toBe(1756800000000);
  });
});

describe("createLogger —— 来源地址与脱敏（IKB29O）", () => {
  it("请求里的每一行都带调用方地址，不只是访问日志那一行", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });
    runWithRequestContext(
      { traceId: "t-1", clientAddress: "203.0.113.9", peerAddress: "10.0.0.1" },
      () => logger.info("deep inside a service"),
    );
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      trace_id: "t-1",
      client_address: "203.0.113.9",
      network_peer_address: "10.0.0.1",
    });
  });

  it("请求之外不写空地址，否则「没有」看起来像「采集失败」", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    createLogger("unit-svc", { ...QUIET, writer }).info("a scheduled job");
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).not.toHaveProperty("client_address");
    expect(parsed).not.toHaveProperty("network_peer_address");
  });

  it("素材 URL 只留 path——签名在 query 里，而 TLS 是全企业可检索的", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    createLogger("unit-svc", { ...QUIET, writer }).info(
      '下载失败 "https://bucket.tos-cn.volces.com/a/b.mp4?X-Tos-Signature=deadbeef"',
    );
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed.body).toBe(
      '下载失败 "https://bucket.tos-cn.volces.com/a/b.mp4?…"',
    );
  });

  it("按键名抹掉凭证，但不碰用来定位的标识", () => {
    const logSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { writer } = fakeWriter();
    createLogger("unit-svc", { ...QUIET, writer }).warn("上游拒绝", {
      authorization: "Bearer sk-live-1",
      idempotency_key: "idem-7",
    });
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed.authorization).toBe("[redacted]");
    expect(parsed.idempotency_key).toBe("idem-7");
  });

  it("runWithTraceId 在深处换 trace 时保住地址", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { writer } = fakeWriter();
    const logger = createLogger("unit-svc", { ...QUIET, writer });
    runWithRequestContext(
      {
        traceId: "outer",
        clientAddress: "203.0.113.9",
        peerAddress: "10.0.0.1",
      },
      () => runWithTraceId("inner", () => logger.info("nested")),
    );
    const parsed = JSON.parse(String(logSpy.mock.calls[0]![0]));
    expect(parsed).toMatchObject({
      trace_id: "inner",
      client_address: "203.0.113.9",
    });
  });
});
