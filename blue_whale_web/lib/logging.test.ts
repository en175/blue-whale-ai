import { describe, expect, it, vi } from "vitest";

const headerStore = new Headers({ "x-trace-id": "trace-from-request" });

vi.mock("next/headers", () => ({
  headers: async () => headerStore,
}));

import { createWebNewApiClient, requestTraceId } from "./logging";
import { runWithTraceId } from "@blue-whale/core";

describe("requestTraceId —— 透传优先/回落", () => {
  it("当前请求带 X-Trace-Id 时原样沿用", async () => {
    await expect(requestTraceId()).resolves.toBe("trace-from-request");
  });

  it("入站无 X-Trace-Id 时回落到链路上下文（后台任务场景）", async () => {
    headerStore.delete("x-trace-id");
    await runWithTraceId("trace-from-als", async () => {
      await expect(requestTraceId()).resolves.toBe("trace-from-als");
    });
    headerStore.set("x-trace-id", "trace-from-request");
  });

  it("入站与链路上下文均无时缺省生成", async () => {
    headerStore.delete("x-trace-id");
    const generated = await requestTraceId();
    expect(generated).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
    headerStore.set("x-trace-id", "trace-from-request");
  });
});

describe("createWebNewApiClient —— 出站与入站 trace 一致（IK73EV）", () => {
  it("出站 X-Trace-Id 沿用入站值", async () => {
    let captured: Headers | null = null;
    const client = createWebNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await client.getAccountCapabilities();
    expect(captured!.get("X-Trace-Id")).toBe("trace-from-request");
  });
});

describe("链路串联（IK73EV 验收核心）—— proxy 注入 → handler 读取 → 出站沿用", () => {
  it("入站 trace 经 proxy 决策后，出站请求沿用同一 trace_id", async () => {
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");

    const request = new NextRequest("http://localhost:3001/api/account/topups", {
      method: "GET",
      headers: { "x-trace-id": "trace-chain-42" },
    });
    const response = proxy(request);
    const injectedTraceId = response.headers.get("x-trace-id");
    expect(injectedTraceId).toBe("trace-chain-42");

    // 桥接假设：proxy 与 route handler 跨编译 bundle，真实传递只能 header 透传；
    // 此处模拟 handler 读到 proxy 注入的下游请求头（真实链路在 e2e 层验证）。
    headerStore.set("x-trace-id", injectedTraceId ?? "");

    let captured: Headers | null = null;
    const client = createWebNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return new Response(JSON.stringify({ success: true, data: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await client.getAccountCapabilities();
    expect(captured!.get("X-Trace-Id")).toBe("trace-chain-42");
  });
});
