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
});
