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

describe("traceMiddleware", () => {
  it("无 x-trace-id 头时生成 traceId 并在下游可用", () => {
    const req = mockReq();
    const res = {} as never;
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
    const res = {} as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).toBe(incomingId);
  });

  it("畸形 x-trace-id 头（>256 字符）时丢弃并生成新 id", () => {
    const invalidId = "x".repeat(257);
    const req = mockReq({ [TRACE_ID_HEADER]: invalidId });
    const res = {} as never;
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
    const res = {} as never;
    let capturedTraceId: string | null = null;

    traceMiddleware(req, res, () => {
      capturedTraceId = getCurrentTraceId();
    });

    expect(capturedTraceId).not.toBeNull();
    expect(capturedTraceId).not.toBe(invalidId);
  });

  it("next 后上下文不泄漏到外层", () => {
    const req = mockReq({ [TRACE_ID_HEADER]: "abc" });
    const res = {} as never;

    traceMiddleware(req, res, () => {
      expect(getCurrentTraceId()).toBe("abc");
    });

    // next 同步返回后，外层无 trace 上下文
    expect(getCurrentTraceId()).toBeNull();
  });
});
