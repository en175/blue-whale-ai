// IK74V8：从 new-api-client.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import { describe, expect, it, vi } from "vitest";

import { NewApiError, createNewApiClient } from "./new-api-client.js";
import { jsonResponse } from "./new-api-client.testlib.js";

describe("new-api client —— 图片与视频生成", () => {
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

  it("banana 请求带上 quality", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ data: [{ url: "https://cdn.test/banana.png" }] });
      },
    });

    await client.generateImages("sk-test", {
      model: "nano-banana",
      prompt: "cat",
      size: "1x1",
      quality: "1k",
      n: 1,
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      size: "1x1",
      quality: "1k",
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

  it("IK7G9X: generateImagesWithReceipt exposes X-Oneapi-Request-Id", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async () =>
        jsonResponse({ data: [{ url: "https://cdn.test/img.png" }] }, 200, {
          "X-Oneapi-Request-Id": "req-receipt-1",
        }),
    });

    const receipt = await client.generateImagesWithReceipt("sk-test", {
      model: "m",
      prompt: "p",
      n: 1,
    });
    expect(receipt.requestId).toBe("req-receipt-1");
    expect(receipt.images).toEqual([{ url: "https://cdn.test/img.png" }]);

    // 兼容：原 generateImages 仍只回图片列表。
    const images = await client.generateImages("sk-test", {
      model: "m",
      prompt: "p",
      n: 1,
    });
    expect(images).toEqual([{ url: "https://cdn.test/img.png" }]);
  });

  it("IK7G9X: getVideoTask parses TaskDto.quota", async () => {
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/v1/video/generations/task-1")) {
          return jsonResponse({
            data: {
              task_id: "task-1",
              status: "success",
              url: "https://cdn.test/v.mp4",
              quota: 880000,
            },
          });
        }
        return jsonResponse({ success: true, data: {} });
      },
    });

    const task = await client.getVideoTask("sk-test", "task-1");
    expect(task.quota).toBe(880000);
  });

  // IKDLQF：供应商线路收到的 prompt 必须与冻结快照按 composeImagePrompt 精确对应。
  it("delivers the composed text-attachment prompt verbatim to the image endpoint", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ data: [{ url: "https://cdn.test/out.png" }] });
      },
    });
    const { composeImagePrompt } = await import("./compose-image-prompt.js");
    const frozenSnapshot = {
      text_attachments: [
        { node_id: "text-1", title: "背景", text: "雨夜" },
        { node_id: "text-2", title: "风格", text: "赛博朋克" },
      ],
      prompt: "暮色",
    };

    await client.generateImages("sk-test", {
      model: "image-model",
      prompt: composeImagePrompt(frozenSnapshot.text_attachments, frozenSnapshot.prompt),
      n: 1,
    });

    expect(requests[0]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(JSON.parse(String(requests[0]?.init.body)).prompt).toBe("雨夜\n\n赛博朋克\n\n暮色");
  });

  // ---- native topup（Model B：结算复用 Go 原生 new-api 充值）----
});
