// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AgentComposer from "./AgentComposer";
import {
  getImageModels,
  getTextModels,
  getVideoModels,
  type ImageModelCapability,
} from "@/app/canvas/_canvas/api/generation";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./auth/AuthContext", () => ({
  useAuth: () => ({
    requireAuth: (_action: unknown, run: () => void) => run(),
  }),
}));

vi.mock("@/app/canvas/_canvas/api/generation", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getImageModels: vi.fn(),
    getTextModels: vi.fn(),
    getVideoModels: vi.fn(),
  };
});

expect.extend(jestDomMatchers);

function capability(
  modelId: string,
  label: string,
  ratios: string[],
): ImageModelCapability {
  return {
    model_id: modelId,
    provider_id: "test",
    model_label: label,
    icon: null,
    supported_sizes: [
      {
        id: "720p",
        label: "720p",
        api_value: "720p",
        width: 1280,
        height: 720,
      },
    ],
    supported_aspect_ratios: ratios,
    supported_formats: [],
    supported_durations: { min: 4, max: 15, step: 1 },
    default_size: "720p",
    default_format: null,
    default_aspect_ratio: ratios[0],
    default_duration: 8,
    features: {
      reference_image: true,
      max_reference_images: 5,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      audio: true,
    },
    version: 1,
    digest: `sha256:${modelId}`,
  };
}

describe("AgentComposer media parameters", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("image-a", "Image A", ["16:9", "1:1"]),
    ]);
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "Video A", ["16:9", "4:3"]),
    ]);
    vi.mocked(getTextModels).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("AI 图片默认使用 16:9", async () => {
    render(<AgentComposer />);
    fireEvent.click(screen.getByRole("button", { name: "AI 图片" }));

    expect(
      await screen.findByRole("button", { name: "宽高比" }),
    ).toHaveTextContent("16:9");
  });

  it("切换 tab 后保留图片和视频参数，且每类模型只拉取一次", async () => {
    render(<AgentComposer />);

    fireEvent.click(screen.getByRole("button", { name: "AI 图片" }));
    const imageRatio = await screen.findByRole("button", {
      name: "宽高比",
    });
    fireEvent.click(imageRatio);
    fireEvent.click(screen.getByRole("option", { name: "1:1" }));

    fireEvent.click(screen.getByRole("button", { name: "AI 视频" }));
    const videoRatio = await screen.findByRole("button", {
      name: "宽高比",
    });
    fireEvent.click(videoRatio);
    fireEvent.click(screen.getByRole("option", { name: "4:3" }));

    fireEvent.click(screen.getByRole("button", { name: "AI 图片" }));
    expect(
      await screen.findByRole("button", { name: "宽高比" }),
    ).toHaveTextContent("1:1");

    fireEvent.click(screen.getByRole("button", { name: "AI 视频" }));
    expect(
      await screen.findByRole("button", { name: "宽高比" }),
    ).toHaveTextContent("4:3");
    expect(getImageModels).toHaveBeenCalledTimes(1);
    expect(getVideoModels).toHaveBeenCalledTimes(1);
  });
});
