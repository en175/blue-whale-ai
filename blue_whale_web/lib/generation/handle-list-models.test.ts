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
});
