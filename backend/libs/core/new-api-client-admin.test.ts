import {describe, expect, it} from "vitest";

import {createNewApiClient} from "./new-api-client.js";
import {jsonResponse} from "./new-api-client.testlib.js";

describe("new-api client —— Go option（RootAuth）与链路追踪", () => {
  it("reads and writes a Go option with root token + New-Api-User header", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (init.method === "GET") {
          return jsonResponse({
            success: true,
            message: "",
            data: [
              { key: "Theme", value: "default" },
              {
                key: "payment_setting",
                value: JSON.stringify({
                  amount_options: [10, 100],
                  amount_discount: { "100": 0.9 },
                  compliance_confirmed: true,
                }),
              },
            ],
          });
        }
        return jsonResponse({ success: true, message: "" });
      },
    });

    await expect(
      client.getRootOption("root-tok", 1, "payment_setting"),
    ).resolves.toBe(
      JSON.stringify({
        amount_options: [10, 100],
        amount_discount: { "100": 0.9 },
        compliance_confirmed: true,
      }),
    );
    await expect(
      client.getRootOption("root-tok", 1, "no_such_key"),
    ).resolves.toBeNull();

    await expect(
      client.putRootOption("root-tok", 1, "payment_setting", '{"a":1}'),
    ).resolves.toBeUndefined();

    for (const { init } of requests) {
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer root-tok");
      expect(headers.get("New-Api-User")).toBe("1");
    }
    const put = requests.find((r) => r.init.method === "PUT");
    expect(JSON.parse(String(put?.init.body))).toEqual({
      key: "payment_setting",
      value: '{"a":1}',
    });
  });

  it("maps a {success:false} option write to a typed error", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({ success: false, message: "权限不足" }, 200),
    });
    await expect(
      client.putRootOption("bad-tok", 1, "payment_setting", "{}"),
    ).rejects.toMatchObject({ message: "权限不足" });
  });
});

describe("new-api client —— X-Trace-Id 出站透传（IK6KQQ）", () => {
  async function captureHeaders(): Promise<Headers> {
    let captured: Headers | null = null;
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return jsonResponse({ success: true, data: {} });
      },
    });
    await client.getPricing();
    expect(captured).not.toBeNull();
    return captured!;
  }

  it("无链路上下文时缺省生成 X-Trace-Id", async () => {
    const headers = await captureHeaders();
    expect(headers.get("X-Trace-Id")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });

  it("链路上下文内出站沿用当前 trace_id", async () => {
    const { runWithTraceId } = await import("./trace.js");
    let headers: Headers | null = null;
    await runWithTraceId("trace-upstream-001", async () => {
      headers = await captureHeaders();
    });
    expect(headers!.get("X-Trace-Id")).toBe("trace-upstream-001");
  });
});

describe("new-api client —— traceIdProvider（IK73EV）", () => {
  it("provider 非空时出站沿用其返回值（优先于链路上下文）", async () => {
    const { runWithTraceId } = await import("./trace.js");
    let captured: Headers | null = null;
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      traceIdProvider: () => "trace-from-bff",
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return jsonResponse({ success: true, data: {} });
      },
    });
    await runWithTraceId("trace-ctx", () => client.getPricing());
    expect(captured!.get("X-Trace-Id")).toBe("trace-from-bff");
  });

  it("provider 返回空时回落到链路上下文", async () => {
    const { runWithTraceId } = await import("./trace.js");
    let captured: Headers | null = null;
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      traceIdProvider: () => null,
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return jsonResponse({ success: true, data: {} });
      },
    });
    await runWithTraceId("trace-ctx-fallback", () => client.getPricing());
    expect(captured!.get("X-Trace-Id")).toBe("trace-ctx-fallback");
  });

  it("provider 返回空且无链路上下文时缺省生成", async () => {
    let captured: Headers | null = null;
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      traceIdProvider: () => null,
      fetchImpl: async (_input, init = {}) => {
        captured = new Headers(init.headers);
        return jsonResponse({ success: true, data: {} });
      },
    });
    await client.getPricing();
    expect(captured!.get("X-Trace-Id")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });
});
