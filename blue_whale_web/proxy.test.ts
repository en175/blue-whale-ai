// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

function makeRequest(traceHeader?: string | null): NextRequest {
  const headers = new Headers();
  if (traceHeader) headers.set("x-trace-id", traceHeader);
  return new NextRequest("http://localhost:3001/api/account/topups", {
    method: "GET",
    headers,
  });
}

describe("proxy —— X-Trace-Id 透传/生成（IK73EV）", () => {
  it("入站已带 X-Trace-Id 时原样沿用并回传响应头", () => {
    const response = proxy(makeRequest("trace-upstream-9"));
    expect(response.headers.get("x-trace-id")).toBe("trace-upstream-9");
  });

  it("入站缺失时生成 trace id（时间戳-随机hex）并回传响应头", () => {
    const response = proxy(makeRequest(null));
    const traceId = response.headers.get("x-trace-id");
    expect(traceId).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });
});
