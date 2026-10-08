import {NewApiError} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest, NewApiRequestWithMeta} from "./new-api-transport.js";
import type {NewApiImage, NewApiImageEditInput, NewApiImageInput, NewApiVideoInput, NewApiVideoSubmission, NewApiVideoTask} from "./new-api-types.js";

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
        const frameItems: Array<Record<string, unknown>> = [];
        const refItems: Array<Record<string, unknown>> = [];
        for (const ref of references) {
          const role = (ref as { role?: string }).role;
          const entry =
            ref.type === "image"
              ? {
                  type: "image_url",
                  image_url: { url: ref.url },
                  role: role ?? "reference_image",
                }
              : ref.type === "audio"
                ? {
                    type: "audio_url",
                    audio_url: { url: ref.url },
                    role: "reference_audio",
                  }
                : {
                    type: "video_url",
                    video_url: { url: ref.url },
                    role: "reference_video",
                  };
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
              : reference.type === "audio"
                ? {
                    type: "audio_url",
                    audio_url: { url: reference.url },
                    role: "reference_audio",
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
        ...(quota !== undefined ? { quota } : {}),
        error,
      };
    },

  };
}

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
