import { describe, expect, it, vi } from "vitest";

import { NewApiError, createNewApiClient } from "./new-api-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("new-api client", () => {
  it("adapts the complete account contract through one client", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/status")) {
          return jsonResponse({
            success: true,
            data: {
              register_enabled: true,
              password_login_enabled: true,
              password_register_enabled: true,
              email_verification: true,
              github_oauth: true,
            },
          });
        }
        if (url.endsWith("/api/user/register")) {
          return jsonResponse({
            success: true,
            data: {
              user_id: 8,
              username: "new-user",
              email: "new@example.com",
              token: "sk-register",
            },
          });
        }
        if (url.endsWith("/api/token/identity")) {
          return jsonResponse({
            success: true,
            data: {
              user_id: 8,
              username: "new-user",
              email: "new@example.com",
              status: 1,
              role: 100,
            },
          });
        }
        return jsonResponse({ code: true, data: { user_quota: 99 } });
      },
    });

    await expect(client.getAccountCapabilities()).resolves.toEqual({
      passwordLogin: true,
      passwordRegister: true,
      emailVerification: true,
    });
    await expect(
      client.register({
        username: "new-user",
        password: "secret",
        email: "new@example.com",
        verificationCode: "123456",
      }),
    ).resolves.toEqual({
      token: "sk-register",
      userId: 8,
      username: "new-user",
      email: "new@example.com",
    });
    await expect(client.resolveTokenIdentity("sk-register")).resolves.toEqual({
      userId: 8,
      username: "new-user",
      email: "new@example.com",
      status: 1,
      role: 100,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "http://new-api.test/api/status",
      "http://new-api.test/api/user/register",
      "http://new-api.test/api/token/identity",
    ]);
    expect(new Headers(requests[2]?.init.headers).get("Authorization")).toBe(
      "Bearer sk-register",
    );
  });

  it("normalizes network failure to 503 and malformed account data to 502", async () => {
    const unreachable = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () => {
        throw new Error("connect ECONNREFUSED http://internal-new-api.test");
      },
    });
    await expect(unreachable.getAccountCapabilities()).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });

    const malformed = createNewApiClient({
      baseUrl: "http://internal-new-api.test",
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          data: { user_id: "not-a-number", token: "secret-without-prefix" },
        }),
    });
    await expect(
      malformed.register({ username: "alice", password: "secret" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "invalid_register_response",
    });
  });

  it("aborts account requests at the configured timeout and reports 503", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      timeoutMs: 5,
      fetchImpl: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });

    await expect(client.getAccountCapabilities()).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("keeps the timeout active while the response body is being read", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      timeoutMs: 5,
      fetchImpl: async (_input, init) => {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    await expect(client.getAccountCapabilities()).rejects.toMatchObject({
      status: 503,
      message: "new-api 不可达",
    });
  });

  it("rejects login responses without a stable user identity", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({
          success: true,
          data: { token: "sk-login", user_id: null, username: null },
        }),
    });

    await expect(
      client.login({ username: "alice", password: "secret" }),
    ).rejects.toMatchObject({
      status: 502,
      code: "invalid_login_response",
    });
  });

  it("uses one sk token for login, usage, logs, and image relay", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test/",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/api/user/login")) {
          return jsonResponse({
            success: true,
            message: "",
            data: { id: 7, username: "alice", token: "sk-login" },
          });
        }
        if (url.endsWith("/api/usage/token/")) {
          return jsonResponse({
            code: true,
            message: "ok",
            data: { user_quota: 123456 },
          });
        }
        if (url.endsWith("/api/log/token")) {
          return jsonResponse({
            success: true,
            message: "",
            data: [{ quota: 42, model_name: "image-model" }],
          });
        }
        return jsonResponse({ data: [{ url: "https://cdn.test/image.png" }] });
      },
    });

    const login = await client.login({ username: "alice", password: "secret" });
    const usage = await client.getTokenUsage(login.token);
    const logs = await client.getTokenLogs(login.token);
    const images = await client.generateImages(login.token, {
      model: "image-model",
      prompt: "a whale",
      n: 1,
    });

    expect(login.token).toBe("sk-login");
    expect(login.userId).toBe(7);
    expect(login.username).toBe("alice");
    expect(usage.userQuota).toBe(123456);
    expect(logs[0]?.quota).toBe(42);
    expect(images).toEqual([{ url: "https://cdn.test/image.png" }]);
    expect(requests[3]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(
      requests
        .slice(1)
        .every(
          ({ init }) =>
            new Headers(init.headers).get("Authorization") ===
            "Bearer sk-login",
        ),
    ).toBe(true);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      username: "alice",
      password: "secret",
    });
    expect(JSON.parse(String(requests[3]?.init.body))).toMatchObject({
      model: "image-model",
      prompt: "a whale",
      n: 1,
      response_format: "url",
      stream: false,
    });
  });

  it("raises a typed error for an HTTP or business failure", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({ success: false, message: "余额不足" }, 402),
    });

    await expect(
      client.generateImages("sk-test", { model: "m", prompt: "p", n: 1 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NewApiError>>({
        status: 402,
        message: "余额不足",
      }),
    );
  });

  it("sends sequential image generation options", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ data: [{ url: "https://cdn.test/sequence.png" }] });
      },
    });

    await client.generateImages("sk-test", {
      model: "image-model",
      prompt: "four related scenes",
      n: 4,
      sequential: true,
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      n: 4,
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: 4 },
    });
  });

  it("preserves nested gateway error details from failed requests", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: "invalid_size",
              message: "size must be one of 1024x1024, 2048x2048",
            },
          },
          400,
        ),
    });

    await expect(
      client.generateImages("sk-test", { model: "m", prompt: "p", size: "2K", n: 1 }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<NewApiError>>({
        status: 400,
        code: "invalid_size",
        message: "size must be one of 1024x1024, 2048x2048",
      }),
    );
  });

  it("sends image edits as authenticated multipart data", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ data: [{ url: "https://cdn.test/edited.png" }] });
      },
    });

    expect(client.editImages).toBeTypeOf("function");
    const images = await client.editImages("sk-test", {
      model: "image-model",
      prompt: "turn it blue",
      image: new Blob(["image-bytes"], { type: "image/png" }),
      fileName: "source.png",
      size: "1024x1024",
      n: 1,
    });

    const request = requests[0];
    const headers = new Headers(request?.init.headers);
    const form = request?.init.body;
    expect(request?.url).toBe("http://new-api.test/v1/images/edits");
    expect(headers.get("Authorization")).toBe("Bearer sk-test");
    expect(headers.get("Content-Type")).toBeNull();
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get("model")).toBe("image-model");
    expect((form as FormData).get("prompt")).toBe("turn it blue");
    expect((form as FormData).get("image")).toBeInstanceOf(Blob);
    expect(images).toEqual([{ url: "https://cdn.test/edited.png" }]);
  });

  it("sends sequential options for image edits", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ data: [{ url: "https://cdn.test/edited.png" }] });
      },
    });

    await client.editImages("sk-test", {
      model: "image-model",
      prompt: "four related edits",
      image: new Blob(["image-bytes"], { type: "image/png" }),
      fileName: "source.png",
      n: 4,
      sequential: true,
      webSearch: true,
    });

    const form = requests[0]?.body as FormData;
    expect(form.get("tools")).toBe(JSON.stringify([{ type: "web_search" }]));
    expect(form.get("sequential_image_generation")).toBe("auto");
    expect(form.get("sequential_image_generation_options")).toBe(
      JSON.stringify({ max_images: 4 }),
    );
  });

  it("sends multiple reference images with the gateway array field", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ data: [{ url: "https://cdn.test/edited.png" }] });
      },
    });

    await client.editImages("sk-test", {
      model: "image-model",
      prompt: "combine four references",
      images: [
        { blob: new Blob(["one"], { type: "image/png" }), fileName: "one.png" },
        { blob: new Blob(["two"], { type: "image/png" }), fileName: "two.png" },
      ],
      n: 1,
    });

    const form = requests[0]?.body as FormData;
    expect(form.getAll("image[]")).toHaveLength(2);
    expect(form.getAll("image")).toHaveLength(0);
  });

  it("submits and polls authenticated video tasks", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        const url = String(input);
        requests.push({ url, init });
        if (init.method === "POST") {
          return jsonResponse({ task_id: "task-1", status: "queued" });
        }
        return jsonResponse({
          code: "success",
          data: {
            task_id: "task-1",
            status: "succeeded",
            url: "https://cdn.test/video.mp4",
          },
        });
      },
    });

    expect(client.submitVideo).toBeTypeOf("function");
    expect(client.getVideoTask).toBeTypeOf("function");
    const submitted = await client.submitVideo("sk-test", {
      model: "video-model",
      prompt: "a whale swims",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      responseFormat: "url",
    });
    const completed = await client.getVideoTask("sk-test", submitted.taskId);

    expect(submitted).toEqual({ taskId: "task-1", status: "queued" });
    expect(completed).toEqual({
      taskId: "task-1",
      status: "succeeded",
      url: "https://cdn.test/video.mp4",
      error: null,
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "http://new-api.test/v1/video/generations",
      "http://new-api.test/v1/video/generations/task-1",
    ]);
    expect(
      requests.every(
        ({ init }) =>
          new Headers(init.headers).get("Authorization") === "Bearer sk-test",
      ),
    ).toBe(true);
  });

  it("maps ordered image and video references into Seedance metadata.content", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ task_id: "task-references", status: "queued" });
      },
    });

    await client.submitVideo("sk-test", {
      model: "doubao-seedance-2-0-260128",
      prompt: "修改视频风格",
      duration: 8,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      references: [
        { type: "image", url: "https://cdn.test/a.png" },
        { type: "video", url: "https://cdn.test/b.mp4" },
        { type: "image", url: "https://cdn.test/c.png" },
      ],
    });

    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      model: "doubao-seedance-2-0-260128",
      prompt: "修改视频风格",
      duration: 8,
      response_format: "url",
      metadata: {
        duration: 8,
        resolution: "720p",
        ratio: "16:9",
        content: [
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/a.png" },
            role: "reference_image",
          },
          {
            type: "video_url",
            video_url: { url: "https://cdn.test/b.mp4" },
            role: "reference_video",
          },
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/c.png" },
            role: "reference_image",
          },
        ],
      },
    });
  });

  it("maps first and last frames into Seedance metadata.content", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ task_id: "task-frames", status: "queued" });
      },
    });

    await client.submitVideo("sk-test", {
      model: "doubao-seedance-2-0-260128",
      prompt: "从首帧到尾帧",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      firstFrameImage: "https://cdn.test/first.png",
      lastFrameImage: "https://cdn.test/last.png",
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      metadata: {
        content: [
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/first.png" },
            role: "first_frame",
          },
          {
            type: "image_url",
            image_url: { url: "https://cdn.test/last.png" },
            role: "last_frame",
          },
        ],
      },
    });
  });

  it("rejects frame inputs mixed with ordinary references before fetch", async () => {
    const fetchImpl = vi.fn();
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl,
    });

    await expect(client.submitVideo("sk-test", {
      model: "doubao-seedance-2-0-260128",
      prompt: "含糊输入",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      firstFrameImage: "https://cdn.test/first.png",
      references: [{ type: "video", url: "https://cdn.test/reference.mp4" }],
    })).rejects.toEqual(
      expect.objectContaining<Partial<NewApiError>>({
        status: 422,
        code: "unsupported_video_inputs",
      }),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // ---- native topup（Model B：结算复用 Go 原生 new-api 充值）----

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
    await client.getAccountCapabilities();
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
    await runWithTraceId("trace-ctx", () => client.getAccountCapabilities());
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
    await runWithTraceId("trace-ctx-fallback", () => client.getAccountCapabilities());
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
    await client.getAccountCapabilities();
    expect(captured!.get("X-Trace-Id")).toMatch(/^[0-9]+-[0-9a-f]{16}$/);
  });
});
