import { describe, expect, it } from "vitest";

import {
  getCurrentTraceId,
  TRACE_ID_HEADER,
  TRACE_ID_PATTERN,
} from "@blue-whale/core/logging";

import { traceMiddleware } from "./trace.middleware.js";

function mockReq(headers: Record<string, string | undefined> = {}) {
  return {
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as { get: (name: string) => string | undefined };
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
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
    // "abc" 在 D6 之前是合法的（旧规则只要求可见 ASCII），现在长度不足 8 会被拒收。
    const req = mockReq({ [TRACE_ID_HEADER]: "abc-12345" });
    const res = mockRes() as never;

    traceMiddleware(req, res, () => {
      expect(getCurrentTraceId()).toBe("abc-12345");
    });

    // next 同步返回后，外层无 trace 上下文
    expect(getCurrentTraceId()).toBeNull();
  });
});

describe("traceMiddleware 响应头", () => {
  it("把 traceId 回给客户端——用户报障时唯一能报出来的东西", () => {
    // New API 早就这么做（middleware/request-id.go）。我们不回带的时候，浏览器里查不到
    // 任何 id，一次报障只能描述成"刚才那次对话"。
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
    // 旧规则是「长度 ≤256 的可见 ASCII」，含空格也放行——而这是每一条跨服务查询的键。
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
    const req = mockReq({ traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" });
    const res = mockRes();
    let inside: string | null = null;

    traceMiddleware(req, res as never, () => {
      inside = getCurrentTraceId();
    });

    expect(inside).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});
