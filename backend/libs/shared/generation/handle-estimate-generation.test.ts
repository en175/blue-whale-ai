import { describe, expect, it, vi } from "vitest";

import type { BillingClient } from "../billing/billing-client.js";
import { createBillingQuote } from "../billing/billing-quote.js";
import {
  handleEstimateGeneration,
  type EstimateGenerationDeps,
} from "./handle-estimate-generation.js";

const USER_ID = "42";
const VIDEO_MODEL_ID = "doubao-seedance-2-0-260128";
const IMAGE_MODEL_ID = "doubao-seedream-5-0-pro-260628";

function fakeClient(credits = 42n) {
  const quote = vi.fn().mockResolvedValue({ credits, catalogVersion: 1 });
  return {
    client: { quote, charge: vi.fn(), queryBalance: vi.fn() } as unknown as BillingClient,
    quote,
  };
}

function defaultModels() {
  return vi.fn().mockResolvedValue([
    { model_id: VIDEO_MODEL_ID, version: 3, features: { audio: true } },
    { model_id: IMAGE_MODEL_ID, version: 4, features: { image_reference_max: 10 } },
  ]);
}

function deps(client: BillingClient, models = defaultModels()): EstimateGenerationDeps {
  return {
    models: { listEnabledByType: models },
    quote: createBillingQuote({
      client,
      resolveTier: async () => "free",
      logger: { warn: vi.fn() },
    }),
  } as unknown as EstimateGenerationDeps;
}

function quoteSpecs(quote: ReturnType<typeof fakeClient>["quote"], index = 0) {
  const request = quote.mock.calls[index]?.[0] as unknown as {
    taskType: string;
    specs: Record<string, string>;
  };
  return request;
}

describe("handleEstimateGeneration", () => {
  it("图片按参考张数计价，未上传的参考也算数", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "image",
        expected_output_count: 1,
        references: [{ type: "image" }, { type: "image" }, { type: "image" }],
        parameters: {
          model_id: IMAGE_MODEL_ID,
          prompt: "融合三张参考",
          size: "1k",
          aspect_ratio: "1:1",
        },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42 });
    const request = quoteSpecs(quote);
    expect(request.taskType).toBe("image");
    expect(request.specs.reference_count).toBe("3");
    expect(request.specs.image_reference).toBe("1");
    expect(request.specs.model_id).toBe(IMAGE_MODEL_ID);
  });

  it("图片不带参考时按零参考计价", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "image",
        parameters: { model_id: IMAGE_MODEL_ID, prompt: "一只橘猫", size: "1k", aspect_ratio: "1:1" },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    const request = quoteSpecs(quote);
    expect(request.specs.reference_count).toBe("0");
    expect(request.specs.image_reference).toBe("0");
  });

  it("视频参考按前端声明的时长累计 reference_seconds", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "video",
        expected_output_count: 1,
        references: [{ type: "image" }, { type: "video", duration: 8 }],
        parameters: {
          model_id: VIDEO_MODEL_ID,
          prompt: "人物走过街角",
          aspect_ratio: "16:9",
          resolution: "720p",
          duration: 8,
          generate_audio: true,
          mode: "text2video",
        },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: 42 });
    const request = quoteSpecs(quote);
    expect(request.taskType).toBe("video");
    expect(request.specs.reference_count).toBe("2");
    expect(request.specs.reference_seconds).toBe("8");
    expect(request.specs.video).toBe("1");
    expect(request.specs.duration).toBe("8");
  });

  it("编辑模式用参考视频时长作为计价基准", async () => {
    const { client, quote } = fakeClient();
    const models = vi.fn().mockResolvedValue([
      {
        model_id: VIDEO_MODEL_ID,
        version: 5,
        features: {
          audio: true,
          video_reference: true,
          task_types: {
            default: { allowed_ratios: ["adaptive"] },
            edit: { allowed_ratios: ["adaptive"] },
          },
        },
      },
    ]);
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "video",
        expected_output_count: 1,
        references: [{ type: "video", duration: 12 }],
        parameters: {
          model_id: VIDEO_MODEL_ID,
          aspect_ratio: "adaptive",
          resolution: "720p",
          duration: -1,
          mode: "edit",
        },
      },
      deps(client, models),
    );

    expect(result.code).toBe(200);
    const specs = quoteSpecs(quote).specs;
    expect(specs.duration).toBe("12");
    expect(specs.video_edit).toBe("1");
    expect(specs.reference_seconds).toBe("0");
  });

  it("视频必须带 mode，缺了就不报价", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "video",
        expected_output_count: 1,
        references: [{ type: "video", duration: 12 }],
        parameters: {
          model_id: VIDEO_MODEL_ID,
          prompt: "把视频里的路牌去掉",
          aspect_ratio: "adaptive",
          resolution: "720p",
          duration: -1,
        },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("模型不在启用白名单时不报价，也不打计费服务", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "image",
        parameters: { model_id: "unknown-model", size: "1k" },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
    expect(quote).not.toHaveBeenCalled();
  });

  it("计费服务异常时降级为空价，不抛错", async () => {
    const quote = vi.fn().mockRejectedValue(new Error("billing down"));
    const client = {
      quote,
      charge: vi.fn(),
      queryBalance: vi.fn(),
    } as unknown as BillingClient;

    const result = await handleEstimateGeneration(
      USER_ID,
      {
        type: "image",
        parameters: { model_id: IMAGE_MODEL_ID, size: "1k" },
      },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
    expect(quote).toHaveBeenCalledTimes(1);
  });

  it("不支持的生成类型直接返回空价", async () => {
    const { client, quote } = fakeClient();
    const result = await handleEstimateGeneration(
      USER_ID,
      { type: "audio", parameters: { model_id: "seed-audio-1.0" } },
      deps(client),
    );

    expect(result.code).toBe(200);
    expect(result.data).toEqual({ credits: null });
    expect(quote).not.toHaveBeenCalled();
  });
});
