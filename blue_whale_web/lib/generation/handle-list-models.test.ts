import { describe, expect, it, vi } from "vitest";

import { handleListModels } from "./handle-list-models.js";

// /api/generation/models：按 capability 查启用模型能力 → 200 + ModelCapabilityView[]。

describe("handleListModels", () => {
  it("返回 repo 结果 → 200", async () => {
    const view = {
      model_id: "doubao-seedream-4-0",
      provider_id: "volc",
      model_label: "Seedream 4.0",
      icon: null,
      supported_sizes: [],
      supported_aspect_ratios: ["1:1"],
      supported_formats: ["png"],
      default_size: "1K",
      default_format: "png",
      default_aspect_ratio: "1:1",
      features: {
        reference_image: false,
        max_reference_images: 0,
        watermark: false,
        quantity_max: 1,
        sequential_image_generation: false,
        stream: false,
        tools: false,
      },
    };
    const repo = { listEnabledByType: vi.fn().mockResolvedValue([view]) };
    const result = await handleListModels("image", { models: repo });
    expect(result).toEqual({ code: 200, msg: null, data: [view] });
    expect(repo.listEnabledByType).toHaveBeenCalledWith("image");
  });

  it("空列表 → 200 + []", async () => {
    const repo = { listEnabledByType: vi.fn().mockResolvedValue([]) };
    const result = await handleListModels("video", { models: repo });
    expect(result).toEqual({ code: 200, msg: null, data: [] });
  });

  it("图片能力表不暴露模型不支持的分辨率", async () => {
    const view = {
      model_id: "doubao-seedream-5-0-pro-260628",
      provider_id: "volc",
      model_label: "Seedream 5.0 Pro",
      icon: null,
      supported_sizes: [
        { id: "1k", label: "1K", api_value: "1K" },
        { id: "2k", label: "2K", api_value: "2K" },
        { id: "4k", label: "4K", api_value: "4K" },
      ],
      supported_aspect_ratios: ["1:1"],
      supported_formats: ["png"],
      default_size: "2k",
      default_format: "png",
      default_aspect_ratio: "1:1",
      features: {
        reference_image: true,
        max_reference_images: 10,
        watermark: false,
        quantity_max: 4,
        sequential_image_generation: false,
        stream: false,
        tools: false,
      },
    };
    const repo = { listEnabledByType: vi.fn().mockResolvedValue([view]) };

    const result = await handleListModels("image", { models: repo });

    expect(result.data?.[0]?.supported_sizes.map((size) => size.id)).toEqual([
      "1k",
      "2k",
    ]);
    expect(result.data?.[0]?.features.reference_image).toBe(true);
  });

  it("图片能力表不暴露 Worker 无法完成的数量", async () => {
    const view = {
      model_id: "doubao-seedream-5-0-260128",
      provider_id: "volc",
      model_label: "Seedream 5.0",
      icon: null,
      supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
      supported_aspect_ratios: ["1:1"],
      supported_formats: ["png"],
      default_size: "2k",
      default_format: "png",
      default_aspect_ratio: "1:1",
      features: {
        reference_image: true,
        max_reference_images: 4,
        watermark: false,
        quantity_max: 15,
        sequential_image_generation: true,
        stream: false,
        tools: true,
      },
    };
    const repo = { listEnabledByType: vi.fn().mockResolvedValue([view]) };

    const result = await handleListModels("image", { models: repo });

    expect(result.data?.[0]?.features.quantity_max).toBe(4);
  });

  it("API 透出 features.max_reference_images", async () => {
    const view = {
      model_id: "doubao-seedream-5-0-pro-260628",
      provider_id: "volcengine",
      model_label: "Seedream 5.0 Pro",
      icon: null,
      supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
      supported_aspect_ratios: ["1:1"],
      supported_formats: ["png"],
      default_size: "2k",
      default_format: "png",
      default_aspect_ratio: "1:1",
      features: {
        reference_image: true,
        max_reference_images: 10,
        watermark: false,
        quantity_max: 4,
        sequential_image_generation: true,
        stream: false,
        tools: true,
      },
    };
    const repo = { listEnabledByType: vi.fn().mockResolvedValue([view]) };

    const result = await handleListModels("image", { models: repo });

    expect(result.data?.[0]?.features.max_reference_images).toBe(10);
  });
});
