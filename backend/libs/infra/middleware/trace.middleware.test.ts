import { describe, expect, it } from "vitest";

import {
  getCurrentTraceId,
  TRACE_ID_HEADER,
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
    const req = mockReq({ [TRACE_ID_HEADER]: "abc" });
    const res = mockRes() as never;

    traceMiddleware(req, res, () => {
      expect(getCurrentTraceId()).toBe("abc");
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
