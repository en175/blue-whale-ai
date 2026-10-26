import { describe, expect, it, vi } from "vitest";

import {
  getCurrentTraceId,
  TRACE_ID_HEADER,
  TRACE_ID_PATTERN,
} from "@lib/core/logging";

import { traceMiddleware } from "./trace.middleware.js";

function mockReq(
  headers: Record<string, string | undefined> = {},
  extra: { method?: string; path?: string; remoteAddress?: string } = {},
) {
  return {
    method: extra.method ?? "GET",
    path: extra.path ?? "/api/health",
    socket: { remoteAddress: extra.remoteAddress },
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as never;
}

function mockRes(statusCode = 200) {
  const headers: Record<string, string> = {};
  const listeners: Record<string, (() => void)[]> = {};
  return {
    headers,
    statusCode,
    writableEnded: true,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    once(event: string, handler: () => void) {
      (listeners[event] ??= []).push(handler);
      return this;
    },
    fire(event: string) {
      for (const handler of listeners[event] ?? []) handler();
    },
  };
}

describe("traceMiddleware", () => {
  it("无 x-trace-id 头时生成 traceId 并在下游可用", () => {
    const req = mockReq();
    const res = mockRes() as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).not.toBeNull();
    expect(capturedTraceId!.length).toBeGreaterThan(0);
  });

  it("合法 x-trace-id 头时透传原值", () => {
    const incomingId = "my-trace-12345";
    const req = mockReq({ [TRACE_ID_HEADER]: incomingId });
    const res = mockRes() as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).toBe(incomingId);
  });

  it("畸形 x-trace-id 头（>256 字符）时丢弃并生成新 id", () => {
    const invalidId = "x".repeat(257);
    const req = mockReq({ [TRACE_ID_HEADER]: invalidId });
    const res = mockRes() as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).not.toBeNull();
    expect(capturedTraceId).not.toBe(invalidId);
    expect(capturedTraceId!.length).toBeLessThanOrEqual(256);
  });

  it("非 ASCII x-trace-id 头时丢弃并生成新 id", () => {
    const invalidId = "trace-中文-值";
    const req = mockReq({ [TRACE_ID_HEADER]: invalidId });
    const res = mockRes() as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).not.toBeNull();
    expect(capturedTraceId).not.toBe(invalidId);
  });

  it("next 后上下文不泄漏到外层", () => {
    const req = mockReq({ [TRACE_ID_HEADER]: "abc-12345" });
    const res = mockRes() as never;

    traceMiddleware(req, res, () => {
      expect(getCurrentTraceId()).toBe("abc-12345");
    });

    expect(getCurrentTraceId()).toBeNull();
  });
});

describe("traceMiddleware 响应头", () => {
  it("把 traceId 回给客户端——用户报障时唯一能报出来的东西", () => {
    const req = mockReq();
    const res = mockRes();
    let inside: string | null = null;

    traceMiddleware(req, res as never, () => {
      inside = getCurrentTraceId();
    });

    expect(res.headers[TRACE_ID_HEADER]).toBe(inside);
  });

  it("透传进来的 id 也照样回带，不是另生成一个", () => {
    const req = mockReq({ [TRACE_ID_HEADER]: "from-upstream-1" });
    const res = mockRes();

    traceMiddleware(req, res as never, () => undefined);

    expect(res.headers[TRACE_ID_HEADER]).toBe("from-upstream-1");
  });
});

describe("traceMiddleware 入站校验（D6）", () => {
  it("旧规则放行的脏值现在被拒收，另生成一个合规 id", () => {
    for (const dirty of ["has space", "abc", 'quote"inside']) {
      const req = mockReq({ [TRACE_ID_HEADER]: dirty });
      const res = mockRes();
      let inside: string | null = null;

      traceMiddleware(req, res as never, () => {
        inside = getCurrentTraceId();
      });

      expect(inside).not.toBe(dirty);
      expect(inside).toMatch(TRACE_ID_PATTERN);
      expect(res.headers[TRACE_ID_HEADER]).toBe(inside);
    }
  });

  it("没有 X-Trace-Id 时认 traceparent", () => {
    const req = mockReq({
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    const res = mockRes();
    let inside: string | null = null;

    traceMiddleware(req, res as never, () => {
      inside = getCurrentTraceId();
    });

    expect(inside).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});

describe("访问日志与来源地址（IKB29O）", () => {
  function captureLines(run: () => void): Record<string, unknown>[] {
    const lines: Record<string, unknown>[] = [];
    const collect = (...args: unknown[]) => {
      try {
        lines.push(JSON.parse(String(args[0])) as Record<string, unknown>);
      } catch {
      }
    };
    const log = vi.spyOn(console, "log").mockImplementation(collect);
    const warn = vi.spyOn(console, "warn").mockImplementation(collect);
    const error = vi.spyOn(console, "error").mockImplementation(collect);
    try {
      run();
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
    return lines;
  }

  it("每个请求一行，含方法、路径、状态、耗时与调用方地址", () => {
    const res = mockRes(200);
    const lines = captureLines(() => {
      traceMiddleware(
        mockReq(
          { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
          {
            method: "POST",
            path: "/api/agent/v1/sessions",
            remoteAddress: "10.0.0.1",
          },
        ),
        res as never,
        () => {},
      );
      res.fire("finish");
    });
    const access = lines.find((line) => line.event === "http.request");
    expect(access).toMatchObject({
      severity_text: "info",
      http_request_method: "POST",
      url_path: "/api/agent/v1/sessions",
      http_response_status_code: 200,
      client_address: "203.0.113.9",
      network_peer_address: "10.0.0.1",
    });
    expect(typeof access!.duration_ms).toBe("number");
  });

  it("只记一行，finish 和 close 都到也一样", () => {
    const res = mockRes(200);
    const lines = captureLines(() => {
      traceMiddleware(mockReq(), res as never, () => {});
      res.fire("finish");
      res.fire("close");
    });
    expect(lines.filter((line) => line.event === "http.request")).toHaveLength(
      1,
    );
  });

  it("5xx 记 warn，其余记 info", () => {
    const res = mockRes(500);
    const lines = captureLines(() => {
      traceMiddleware(mockReq(), res as never, () => {});
      res.fire("finish");
    });
    expect(lines.find((line) => line.event === "http.request")).toMatchObject({
      severity_text: "warn",
      http_response_status_code: 500,
    });
  });

  it("伪造的 X-Forwarded-For 只能添一个声称，抹不掉 socket 对端", () => {
    const res = mockRes();
    const lines = captureLines(() => {
      traceMiddleware(
        mockReq(
          { "x-forwarded-for": "8.8.8.8" },
          { remoteAddress: "::ffff:10.0.0.1" },
        ),
        res as never,
        () => {},
      );
      res.fire("finish");
    });
    expect(lines.find((line) => line.event === "http.request")).toMatchObject({
      client_address: "8.8.8.8",
      network_peer_address: "10.0.0.1",
    });
  });
});
