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

  it("图生图参考图走 generations 的 image 字段", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ data: [{ url: "https://cdn.test/i2i.png" }] });
      },
    });

    await client.generateImages("sk-test", {
      model: "nano-banana-2-i2i",
      prompt: "钓到一条巨大的金枪鱼",
      size: "1x1",
      quality: "1k",
      n: 1,
      image: "https://asset/5829.png",
    });

    expect(requests[0]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      image: "https://asset/5829.png",
      size: "1x1",
      quality: "1k",
    });
  });

  it("多张参考图以 image 数组发给 generations", async () => {
    const requests: RequestInit[] = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (_input, init = {}) => {
        requests.push(init);
        return jsonResponse({ data: [{ url: "https://cdn.test/i2i.png" }] });
      },
    });

    await client.generateImages("sk-test", {
      model: "nano-banana-2-i2i",
      prompt: "combine",
      n: 1,
      image: ["https://asset/1.png", "https://asset/2.png"],
    });

    expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
      image: ["https://asset/1.png", "https://asset/2.png"],
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

  it("rejects frame inputs mixed with ordinary references before fetch (legacy firstFrameImage field)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { task_id: "t-1", status: "queued" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl,
    });

    // 旧分字段路径：firstFrameImage + references 仍被拒（互斥守卫保留）。
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

    // IKDJNZ 单数组语义：references 带 role 的帧条目与普通参考可并存，不再互斥。
    await client.submitVideo("sk-test", {
      model: "doubao-seedance-2-0-260128",
      prompt: "单数组并存",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      references: [
        { type: "image", url: "asset://Asset-ff-1", role: "first_frame" },
        { type: "image", url: "asset://Asset-last-1", role: "last_frame" },
        { type: "video", url: "https://cdn.test/reference.mp4" },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps audio reference into Seedance metadata.content audio_url (IKDJNZ)", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ task_id: "task-audio-ref", status: "queued" });
      },
    });

    await client.submitVideo("sk-test", {
      model: "doubao-seedance-2-0-260128",
      prompt: "参考音频生成视频",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
      references: [
        { type: "audio", url: "asset://asset-audio-1" },
        { type: "audio", url: "https://tos.test/1.mp3" },
      ],
    });

    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      model: "doubao-seedance-2-0-260128",
      prompt: "参考音频生成视频",
      duration: 5,
      response_format: "url",
      metadata: {
        duration: 5,
        resolution: "720p",
        ratio: "16:9",
        content: [
          {
            type: "audio_url",
            audio_url: { url: "asset://asset-audio-1" },
            role: "reference_audio",
          },
          {
            type: "audio_url",
            audio_url: { url: "https://tos.test/1.mp3" },
            role: "reference_audio",
          },
        ],
      },
    });
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

  // IKH8AU（IKH9NU）：ADR-0088 起服务端不再组合正文——执行侧原样发送 `input.prompt`。本条只验证
  // 「出站 prompt 与传入值逐字一致」，传入值怎么来的不再由本测试负责（组合助手已退役删除）。
  it("delivers the frozen provider prompt verbatim to the image endpoint", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const client = createNewApiClient({
      baseUrl: "http://new-api.test",
      fetchImpl: async (input, init = {}) => {
        requests.push({ url: String(input), init });
        return jsonResponse({ data: [{ url: "https://cdn.test/out.png" }] });
      },
    });
    // 冻结快照里的正文由提交方给全；取值任意（本条只验透传，不代表任何组合格式）。
    const frozenProviderPrompt = "frozen-prompt-body";

    await client.generateImages("sk-test", {
      model: "image-model",
      prompt: frozenProviderPrompt,
      n: 1,
    });

    expect(requests[0]?.url).toBe("http://new-api.test/v1/images/generations");
    expect(JSON.parse(String(requests[0]?.init.body)).prompt).toBe("frozen-prompt-body");
  });

  // ---- native topup（Model B：结算复用 Go 原生 new-api 充值）----
});
