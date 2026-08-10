// IK74V8：从 new-api-client.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import {describe, expect, it} from "vitest";

import {createNewApiClient} from "./new-api-client.js";
import {jsonResponse} from "./new-api-client.testlib.js";

describe("new-api client —— 充值与流水", () => {
  it("quotes, orders, and polls native topup through the user endpoints", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ url, body });
        if (url.endsWith("/api/user/amount")) {
          // 原生报价信封：{message:"success", data:"<两位小数字符串>"}
          return jsonResponse({ message: "success", data: "85.00" });
        }
        if (url.endsWith("/api/user/bluewhalepay/pay")) {
          return jsonResponse({
            message: "success",
            data: { pay_data: "https://pay.test/qr/BWP1", order_id: "BWP1xyz" },
          });
        }
        if (url.includes("/api/user/topup/self")) {
          return jsonResponse({
            success: true,
            message: "",
            data: {
              items: [
                {
                  trade_no: "BWP1xyz",
                  status: "success",
                  amount: 100,
                  money: 85,
                  create_time: 1,
                  complete_time: 2,
                  payment_method: "bluewhalepay",
                },
                {
                  trade_no: "BWPother",
                  status: "pending",
                  amount: 50,
                  money: 45,
                  create_time: 1,
                  complete_time: 0,
                },
              ],
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });

    await expect(client.requestTopUpAmount("sk-t", 100)).resolves.toBe(85);
    await expect(
      client.createBlueWhalePayTopUp("sk-t", 100, "WX_NATIVE"),
    ).resolves.toEqual({
      tradeNo: "BWP1xyz",
      payData: "https://pay.test/qr/BWP1",
    });
    await expect(client.getTopUpByTradeNo("sk-t", "BWP1xyz")).resolves.toEqual({
      trade_no: "BWP1xyz",
      status: "success",
      amount: 100,
      money: 85,
      create_time: 1,
      complete_time: 2,
      payment_method: "bluewhalepay",
    });
    // 精确匹配单号：其它订单不命中 → null
    await expect(client.getTopUpByTradeNo("sk-t", "BWPnope")).resolves.toBeNull();

    // 下单透传 amount + way_code；查询带 keyword
    const orderReq = requests.find((r) =>
      r.url.endsWith("/api/user/bluewhalepay/pay"),
    );
    expect(orderReq?.body).toEqual({ amount: 100, way_code: "WX_NATIVE" });
    expect(
      requests.some((r) =>
        r.url.includes("/api/user/topup/self?keyword=BWP1xyz"),
      ),
    ).toBe(true);
  });

  it("lists user topups and consume logs from Go PageInfo envelopes", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, headers: new Headers(init.headers) });
        if (url.includes("/api/user/topup/self")) {
          return jsonResponse({
            success: true,
            message: "",
            data: {
              page: 1,
              page_size: 20,
              total: 2,
              items: [
                {
                  trade_no: "BWP2",
                  status: "pending",
                  amount: 10,
                  money: 9,
                  create_time: 20,
                  complete_time: 0,
                  payment_method: "bluewhalepay",
                },
                // 缺字段元素 → 兜底解析
                { trade_no: "BWP1", status: "success" },
              ],
            },
          });
        }
        if (url.includes("/api/log/self")) {
          return jsonResponse({
            success: true,
            message: "",
            data: {
              page: 1,
              page_size: 20,
              total: 1,
              items: [
                {
                  id: 7,
                  type: 2,
                  content: "图片生成",
                  model_name: "doubao-seedream-4-0-250828",
                  quota: 120000,
                  created_at: 1750000000,
                },
              ],
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });

    const topups = await client.listUserTopUps("sk-user-token");
    expect(topups.total).toBe(2);
    expect(topups.items[0]).toEqual({
      trade_no: "BWP2",
      status: "pending",
      amount: 10,
      money: 9,
      create_time: 20,
      complete_time: 0,
      payment_method: "bluewhalepay",
    });
    expect(topups.items[1]).toEqual({
      trade_no: "BWP1",
      status: "success",
      amount: 0,
      money: 0,
      create_time: 0,
      complete_time: 0,
      payment_method: "",
    });

    const logs = await client.listUserConsumeLogs("sk-user-token");
    expect(logs.total).toBe(1);
    expect(logs.items[0]).toEqual({
      id: 7,
      type: 2,
      content: "图片生成",
      model_name: "doubao-seedream-4-0-250828",
      quota: 120000,
      created_at: 1750000000,
    });

    // 分页参数；账户层鉴权只凭 sk- 令牌，不发 New-Api-User（ADR-0062 #18）
    const topupReq = requests.find((r) =>
      r.url.includes("/api/user/topup/self"),
    );
    expect(topupReq?.url).toContain("/api/user/topup/self?p=1&page_size=20");
    expect(topupReq?.headers.get("New-Api-User")).toBeNull();
    expect(topupReq?.headers.get("Authorization")).toBe("Bearer sk-user-token");
    const logReq = requests.find((r) => r.url.includes("/api/log/self"));
    expect(logReq?.url).toContain("/api/log/self?p=1&page_size=20&type=2");
    expect(logReq?.headers.get("New-Api-User")).toBeNull();
    expect(logReq?.headers.get("Authorization")).toBe("Bearer sk-user-token");
  });

  it("IK7G9X: resolves a consume log by request_id", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/api/log/self")) {
          return jsonResponse({
            success: true,
            message: "",
            data: {
              page: 1,
              page_size: 20,
              total: 1,
              items: [
                {
                  id: 9,
                  type: 2,
                  content: "图片生成",
                  model_name: "doubao-seedream-4-0-250828",
                  quota: 120000,
                  created_at: 1750000000,
                  request_id: "req-abc123",
                },
                {
                  id: 8,
                  type: 2,
                  content: "视频生成",
                  model_name: "doubao-seedance-2-0-260128",
                  quota: 300000,
                  created_at: 1749999999,
                  request_id: "req-other",
                },
              ],
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });
    const hit = await client.getConsumeLogByRequestId("sk-user-token", "req-abc123");
    expect(hit).toEqual({
      id: 9,
      type: 2,
      content: "图片生成",
      model_name: "doubao-seedream-4-0-250828",
      quota: 120000,
      created_at: 1750000000,
    });
    const miss = await client.getConsumeLogByRequestId("sk-user-token", "req-nope");
    expect(miss).toBeNull();
  });

  it("maps native topup {message:'error'} envelopes to typed errors", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/api/user/amount")) {
          // HTTP 200 但 message=error，data 为错误字符串（无 success 布尔）
          return jsonResponse({ message: "error", data: "充值金额过低" });
        }
        if (url.endsWith("/api/user/bluewhalepay/pay")) {
          return jsonResponse({ message: "error", data: "拉起支付失败" });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });
    await expect(client.requestTopUpAmount("sk-t", 1)).rejects.toMatchObject({
      status: 400,
      code: "topup_amount_error",
      message: "充值金额过低",
    });
    await expect(
      client.createBlueWhalePayTopUp("sk-t", 100),
    ).rejects.toMatchObject({
      status: 400,
      code: "topup_order_error",
      message: "拉起支付失败",
    });
  });

  it("sends only the Bearer sk- token on native topup without New-Api-User", async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, headers: new Headers(init.headers) });
        if (url.endsWith("/api/user/amount")) {
          return jsonResponse({ message: "success", data: "85.00" });
        }
        if (url.endsWith("/api/user/bluewhalepay/pay")) {
          return jsonResponse({
            message: "success",
            data: { pay_data: "https://pay.test/qr/BWP1", order_id: "BWP1xyz" },
          });
        }
        if (url.includes("/api/user/topup/self")) {
          return jsonResponse({ success: true, data: { items: [] } });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });

    // 账户层契约：三个原生充值接口只发 Bearer sk-xxx，订单 User ID 由 Go
    // 从 Token 属主解析，客户端不得伪造或透传 New-Api-User。
    await client.requestTopUpAmount("sk-user", 100);
    await client.createBlueWhalePayTopUp("sk-user", 100, "WX_NATIVE");
    await client.getTopUpByTradeNo("sk-user", "BWP1xyz");
    expect(requests).toHaveLength(3);
    for (const r of requests) {
      expect(r.headers.get("Authorization")).toBe("Bearer sk-user");
      expect(r.headers.get("New-Api-User")).toBeNull();
    }
  });

  // ---- Go 管理端 option（RootAuth）----
});
