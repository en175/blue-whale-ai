// IK74V8：从 new-api-client.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it} from "vitest";

import {createNewApiClient} from "./new-api-client.js";
import {jsonResponse} from "./new-api-client.testlib.js";

describe("new-api client —— 管理面与链路追踪", () => {
  it("reads and writes a Go option with root token + New-Api-User header", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (init.method === "GET") {
          // GET /api/option/ 返回全量 [{key,value}]，value 恒为字符串
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
        // PUT /api/option/ 成功壳
        return jsonResponse({ success: true, message: "" });
      },
    });

    // 读：命中键返回原始字符串；未命中返回 null
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

    // 写：value 作为 JSON 字符串透传
    await expect(
      client.putRootOption("root-tok", 1, "payment_setting", '{"a":1}'),
    ).resolves.toBeUndefined();

    // 两个请求都带 root Authorization + New-Api-User 头
    for (const { init } of requests) {
      const headers = new Headers(init.headers);
      expect(headers.get("Authorization")).toBe("Bearer root-tok");
      expect(headers.get("New-Api-User")).toBe("1");
    }
    // PUT 体：{key, value}，value 为字符串（Go UpdateOption 要求字符串值）
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

  it("adapts the admin user list/search contract with paging", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes("/api/user/search")) {
          return jsonResponse({
            success: true,
            data: {
              page: 1,
              page_size: 20,
              total: 1,
              items: [
                {
                  id: 42,
                  username: "alice",
                  display_name: "爱丽丝",
                  email: "a@x.com",
                  role: 1,
                  status: 1,
                  quota: 1000,
                  used_quota: 200,
                  created_at: 1700000000,
                },
              ],
            },
          });
        }
        return jsonResponse({
          success: true,
          data: { page: 1, page_size: 20, total: 0, items: [] },
        });
      },
    });

    // 有筛选 → /api/user/search，参数带 status/role/p/page_size
    const search = await client.listAdminUsers("sk-admin", 1, {
      keyword: "ali",
      status: 0,
      role: 1,
      page: 2,
      pageSize: 10,
    });
    expect(search.total).toBe(1);
    expect(search.items[0]?.username).toBe("alice");
    expect(requests[0]?.url).toBe(
      "http://new-api.test/api/user/search?keyword=ali&status=0&role=1&p=2&page_size=10",
    );

    // 无筛选 → /api/user/（尾斜杠，IK6M2F）
    await client.listAdminUsers("sk-admin", 1);
    expect(requests[1]?.url).toBe(
      "http://new-api.test/api/user/?p=1&page_size=20",
    );
    expect(new Headers(requests[0]?.init.headers).get("Authorization")).toBe(
      "Bearer sk-admin",
    );
    // IK6M2F：管理端请求须带 New-Api-User 头（authHelper 强制）
    expect(new Headers(requests[0]?.init.headers).get("New-Api-User")).toBe("1");
    expect(new Headers(requests[1]?.init.headers).get("New-Api-User")).toBe("1");
  });

  it("adapts admin manage / topup / complete / log-stat / log endpoints", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.includes("/api/user/topup")) {
          return jsonResponse({
            success: true,
            data: {
              page: 1,
              page_size: 20,
              total: 1,
              items: [
                {
                  id: 9,
                  user_id: 42,
                  amount: 6000,
                  money: 60,
                  trade_no: "BWP1",
                  payment_method: "bluewhalepay",
                  payment_provider: "bluewhalepay",
                  create_time: 1700000000,
                  complete_time: 1700003600,
                  status: "success",
                },
              ],
            },
          });
        }
        if (url.includes("/api/log/stat")) {
          return jsonResponse({
            success: true,
            data: { quota: 320, rpm: 5, tpm: 100 },
          });
        }
        if (url.includes("/api/log")) {
          return jsonResponse({
            success: true,
            data: {
              page: 1,
              page_size: 5,
              total: 1,
              items: [
                {
                  id: 1,
                  user_id: 7,
                  created_at: 1700000000,
                  type: 2,
                  username: "bob",
                  model_name: "gpt-4o",
                  quota: 50,
                  prompt_tokens: 10,
                  completion_tokens: 20,
                },
              ],
            },
          });
        }
        return jsonResponse({ success: true, message: "" });
      },
    });

    await expect(
      client.manageAdminUser("sk-admin", 1, { id: 42, action: "disable" }),
    ).resolves.toBeUndefined();
    expect(requests[0]?.url).toBe("http://new-api.test/api/user/manage");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      id: 42,
      action: "disable",
    });
    expect(new Headers(requests[0]?.init.headers).get("New-Api-User")).toBe("1");

    const topups = await client.listAdminTopUps("sk-admin", 1, {
      keyword: "BWP",
    });
    expect(topups.items[0]?.trade_no).toBe("BWP1");
    expect(requests[1]?.url).toBe(
      "http://new-api.test/api/user/topup?keyword=BWP&p=1&page_size=20",
    );

    await expect(
      client.completeAdminTopUp("sk-admin", 1, "BWP1"),
    ).resolves.toBeUndefined();
    expect(requests[2]?.url).toBe(
      "http://new-api.test/api/user/topup/complete",
    );
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({
      trade_no: "BWP1",
    });

    const stat = await client.getAdminLogStat("sk-admin", 1, {
      type: 2,
      startTimestamp: 1700000000,
      endTimestamp: 1700003600,
    });
    expect(stat).toEqual({ quota: 320, rpm: 5, tpm: 100 });
    expect(requests[3]?.url).toBe(
      "http://new-api.test/api/log/stat?type=2&start_timestamp=1700000000&end_timestamp=1700003600",
    );

    const logs = await client.listAdminLogs("sk-admin", 1, { pageSize: 5 });
    expect(logs.items[0]?.model_name).toBe("gpt-4o");
    // IK6M2F：/api/log 列表路由须带尾斜杠
    expect(requests[4]?.url).toBe(
      "http://new-api.test/api/log/?p=1&page_size=5",
    );
    expect(new Headers(requests[4]?.init.headers).get("New-Api-User")).toBe("1");
  });

  it("normalizes admin page envelopes with missing fields", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({ success: true, data: { items: undefined } }),
    });
    const page = await client.listAdminTopUps("sk-admin", 1);
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.page).toBe(1);
    expect(page.page_size).toBe(20);
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
    await client.getTokenLogs("sk-x");
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
    await runWithTraceId("trace-ctx", () => client.getTokenLogs("sk-x"));
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
    await runWithTraceId("trace-ctx-fallback", () => client.getTokenLogs("sk-x"));
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
    await client.getTokenLogs("sk-x");
    expect(captured!.get("X-Trace-Id")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });
});
