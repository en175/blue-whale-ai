// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 生成面：图片生成/编辑与视频提交、任务查询。
// IK7G9X：新增 with-receipt 变体（透出 X-Oneapi-Request-Id，供消费流水精确关联）；
// getVideoTask 解析 TaskDto.quota（视频实扣金额来源）。
import {NewApiError} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest, NewApiRequestWithMeta} from "./new-api-transport.js";
import type {NewApiImage, NewApiImageEditInput, NewApiImageInput, NewApiVideoInput, NewApiVideoSubmission, NewApiVideoTask} from "./new-api-types.js";

/** 图片生成结果 + 本次调用的 request_id（消费流水精确关联键，IK7G9X）。 */
export interface NewApiImageReceipt {
  images: NewApiImage[];
  requestId: string | null;
}

export function createNewApiGenerationOps(
  request: NewApiRequest,
  requestWithMeta?: NewApiRequestWithMeta,
) {
  return {
    async generateImages(
      token: string,
      input: NewApiImageInput,
    ): Promise<NewApiImage[]> {
      const receipt = await this.generateImagesWithReceipt(token, input);
      return receipt.images;
    },

    async generateImagesWithReceipt(
      token: string,
      input: NewApiImageInput,
    ): Promise<NewApiImageReceipt> {
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        response_format: "url",
        stream: false,
      };
      if (input.size) body.size = input.size;
      if (input.quality) body.quality = input.quality;
      if (input.image !== undefined) body.image = input.image;
      body.n = input.n;
      if (input.webSearch) body.tools = [{ type: "web_search" }];
      if (input.sequential) {
        body.sequential_image_generation = "auto";
        body.sequential_image_generation_options = { max_images: input.n };
      }

      if (!requestWithMeta) {
        const response = await request<NewApiEnvelope>(
          "/v1/images/generations",
          {
            method: "POST",
            body: JSON.stringify(body),
          },
          token,
        );
        return { images: parseImageList(response.data), requestId: null };
      }
      const {data, requestId} = await requestWithMeta<NewApiEnvelope>(
        "/v1/images/generations",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      return { images: parseImageList(data.data), requestId };
    },

    async editImages(
      token: string,
      input: NewApiImageEditInput,
    ): Promise<NewApiImage[]> {
      const receipt = await this.editImagesWithReceipt(token, input);
      return receipt.images;
    },

    async editImagesWithReceipt(
      token: string,
      input: NewApiImageEditInput,
    ): Promise<NewApiImageReceipt> {
      const body = new FormData();
      body.append("model", input.model);
      body.append("prompt", input.prompt);
      const images =
        input.images ??
        (input.image && input.fileName
          ? [{ blob: input.image, fileName: input.fileName }]
          : []);
      if (images.length === 0) {
        throw new NewApiError("图片编辑至少需要一张参考图", 400, "invalid_input");
      }
      const imageField = images.length === 1 ? "image" : "image[]";
      for (const image of images) {
        body.append(imageField, image.blob, image.fileName);
      }
      body.append("n", String(input.n));
      body.append("response_format", "url");
      if (input.size) body.append("size", input.size);
      if (input.quality) body.append("quality", input.quality);
      if (input.webSearch) {
        body.append("tools", JSON.stringify([{ type: "web_search" }]));
      }
      if (input.sequential) {
        body.append("sequential_image_generation", "auto");
        body.append(
          "sequential_image_generation_options",
          JSON.stringify({ max_images: input.n }),
        );
      }

      if (!requestWithMeta) {
        const response = await request<NewApiEnvelope>(
          "/v1/images/edits",
          {
            method: "POST",
            body,
          },
          token,
        );
        return { images: parseImageList(response.data), requestId: null };
      }
      const {data, requestId} = await requestWithMeta<NewApiEnvelope>(
        "/v1/images/edits",
        {
          method: "POST",
          body,
        },
        token,
      );
      return { images: parseImageList(data.data), requestId };
    },

    async submitVideo(token: string, input: NewApiVideoInput): Promise<NewApiVideoSubmission> {
      const references = input.references ?? [
        ...(input.image ? [{ type: "image" as const, url: input.image }] : []),
        ...(input.referenceImages ?? []).map((url) => ({
          type: "image" as const,
          url,
        })),
      ];
      // IKDJNZ：单数组 references 语义——首尾帧与普通参考可并存。检测方式：references 里
      // 存在带 role(first_frame/last_frame) 的条目。旧分字段路径（references 仅普通参考、
      // 无 role）仍走首尾帧互斥检查。
      const useSingleArray =
        Array.isArray(input.references) &&
        input.references.some(
          (r) => r.role === "first_frame" || r.role === "last_frame",
        );
      if (!useSingleArray) {
        const hasFrames = Boolean(input.firstFrameImage || input.lastFrameImage);
        if (
          (input.lastFrameImage && !input.firstFrameImage) ||
          (hasFrames && references.length > 0)
        ) {
          throw new NewApiError(
            "首尾帧模式不能与普通参考素材混用",
            422,
            "unsupported_video_inputs",
          );
        }
      }
      const content: Array<Record<string, unknown>> = [];
      if (useSingleArray) {
        // 帧（first_frame/last_frame）在前、普通参考随后，保序。
        const frameItems: Array<Record<string, unknown>> = [];
        const refItems: Array<Record<string, unknown>> = [];
        for (const ref of references) {
          const entry =
            ref.type === "image"
              ? {
                  type: "image_url",
                  image_url: { url: ref.url },
                  role: (ref as { role?: string }).role ?? "reference_image",
                }
              : {
                  type: "video_url",
                  video_url: { url: ref.url },
                  role: "reference_video",
                };
          const role = (ref as { role?: string }).role;
          if (role === "first_frame" || role === "last_frame") frameItems.push(entry);
          else refItems.push(entry);
        }
        content.push(...frameItems, ...refItems);
      } else {
        if (input.firstFrameImage) {
          content.push({
            type: "image_url",
            image_url: { url: input.firstFrameImage },
            role: "first_frame",
          });
        }
        if (input.lastFrameImage) {
          content.push({
            type: "image_url",
            image_url: { url: input.lastFrameImage },
            role: "last_frame",
          });
        }
        for (const reference of references) {
          content.push(
            reference.type === "image"
              ? {
                  type: "image_url",
                  image_url: { url: reference.url },
                  role: "reference_image",
                }
              : {
                  type: "video_url",
                  video_url: { url: reference.url },
                  role: "reference_video",
                },
          );
        }
      }
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        duration: input.duration,
        response_format: input.responseFormat ?? "url",
        metadata: {
          duration: input.duration,
          resolution: input.resolution,
          ratio: input.ratio,
          content,
        },
      };

      const response = await request<Record<string, unknown>>(
        "/v1/video/generations",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      const data =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : response;
      const taskId = data.task_id ?? data.id;
      if (typeof taskId !== "string" || taskId.length === 0) {
        throw new NewApiError(
          "new-api 视频提交响应缺少 task_id",
          502,
          "invalid_video_response",
          response,
        );
      }
      return {
        taskId,
        status: typeof data.status === "string" ? data.status : "queued",
      };
    },

    async getVideoTask(
      token: string,
      taskId: string,
    ): Promise<NewApiVideoTask> {
      const response = await request<Record<string, unknown>>(
        `/v1/video/generations/${encodeURIComponent(taskId)}`,
        { method: "GET" },
        token,
      );
      const data =
        response.data && typeof response.data === "object"
          ? (response.data as Record<string, unknown>)
          : response;
      const responseTaskId = data.task_id ?? data.id;
      if (
        typeof responseTaskId !== "string" ||
        typeof data.status !== "string"
      ) {
        throw new NewApiError(
          "new-api 视频任务响应无效",
          502,
          "invalid_video_response",
          response,
        );
      }
      const rawError = data.error;
      const error =
        rawError && typeof rawError === "object"
          ? {
              code:
                typeof (rawError as Record<string, unknown>).code ===
                  "string" ||
                typeof (rawError as Record<string, unknown>).code === "number"
                  ? ((rawError as Record<string, unknown>).code as
                      string | number)
                  : null,
              message:
                typeof (rawError as Record<string, unknown>).message ===
                "string"
                  ? ((rawError as Record<string, unknown>).message as string)
                  : "视频生成失败",
            }
          : null;
      const quota = typeof data.quota === "number" ? data.quota : undefined;
      return {
        taskId: responseTaskId,
        status: data.status,
        url:
          typeof data.url === "string"
            ? data.url
            : typeof data.result_url === "string"
              ? data.result_url
              : null,
        // IK7G9X：TaskDto.quota —— 任务当前 quota（预扣额，结算后=实际扣费额）。
        // 轮询成功（status 已是终态）时读到的是 new-api 结算后的真实扣费。
        ...(quota !== undefined ? { quota } : {}),
        error,
      };
    },

    // ---- recharge ----
  };
}

/** 从信封 data 提取图片列表（缺 url 的元素丢弃）。generateImages/editImages 共用。 */
function parseImageList(data: unknown): NewApiImage[] {
  const list = Array.isArray(data) ? data : [];
  return list.filter((item): item is NewApiImage => {
    return (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { url?: unknown }).url === "string"
    );
  });
}
