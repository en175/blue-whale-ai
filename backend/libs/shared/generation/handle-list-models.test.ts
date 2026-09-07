import { describe, expect, it, vi } from "vitest";

import type { ModelCapabilityView } from "@lib/shared/persistence/index.js";
import { handleListModels } from "./handle-list-models.js";

function imageView(
  overrides: Partial<ModelCapabilityView> = {},
): ModelCapabilityView {
  return {
    model_id: "gpt-image-2",
    provider_id: "new-api",
    model_label: "GPT Image 2",
    icon: null,
    supported_sizes: [
      {
        id: "1k",
        label: "1K",
        api_value: "1024x1024",
        width: 1024,
        height: 1024,
      },
      {
        id: "2k",
        label: "2K",
        api_value: "2048x2048",
        width: 2048,
        height: 2048,
      },
    ],
    supported_aspect_ratios: ["1:1", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"],
    supported_formats: ["png"],
    supported_durations: null,
    default_size: "1k",
    default_format: "png",
    default_aspect_ratio: "1:1",
    default_duration: null,
    features: {
      reference_image: false,
      max_reference_images: 10,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: false,
      last_frame: false,
      first_last_frame: false,
      audio: false,
    },
    version: 1,
    digest: "sha256:abc",
    channel_parser: "gpt",
    request_mapping: {
      matrix: {
        "1k": { "1:1": "1024x1024", "3:2": "1536x1024" },
        "2k": { "1:1": "2048x2048", "16:9": "2048x1152" },
      },
    },
    ...overrides,
  };
}

describe("handleListModels 消费端剥调用值", () => {
  it("不返回像素 / 1x1 / 1k 调用值，并按已填交叉格过滤比例", async () => {
    const result = await handleListModels("image", {
      models: { listEnabledByType: vi.fn().mockResolvedValue([imageView()]) },
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toContain("1024x1024");
    expect(payload).not.toContain("2048x1152");
    expect(payload).not.toContain("1536x1024");
    expect(payload).not.toContain("1x1");
    const models = (result as { data: Array<Record<string, unknown>> }).data;
    const gpt = models[0] as {
      supported_sizes: Array<{
        id: string;
        label: string;
        available_aspect_ratios: string[];
        api_value?: unknown;
      }>;
      request_mapping?: unknown;
      channel_parser?: unknown;
    };
    expect(gpt.supported_sizes[0]).toEqual({
      id: "1k",
      label: "1K",
      available_aspect_ratios: ["1:1", "3:2"],
    });
    expect(gpt.supported_sizes[1]?.available_aspect_ratios).toEqual([
      "1:1",
      "16:9",
    ]);
    expect(gpt.request_mapping).toBeUndefined();
    expect(gpt.channel_parser).toBeUndefined();
  });

  it("banana 不把 1k / 1x1 调用值透给消费端", async () => {
    const result = await handleListModels("image", {
      models: {
        listEnabledByType: vi.fn().mockResolvedValue([
          imageView({
            model_id: "nano-banana",
            channel_parser: "banana",
            request_mapping: {
              quality: { "1k": "1k", "2k": "2k" },
              size: { "1:1": "1x1", "16:9": "16x9" },
            },
          }),
        ]),
      },
    });
    const payload = JSON.stringify(result);
    expect(payload).not.toMatch(/"1x1"/);
    const banana = (
      result as {
        data: Array<{
          supported_sizes: Array<{ available_aspect_ratios: string[] }>;
        }>;
      }
    ).data[0];
    expect(banana?.supported_sizes[0]?.available_aspect_ratios).toEqual([
      "1:1",
      "16:9",
    ]);
  });
});
