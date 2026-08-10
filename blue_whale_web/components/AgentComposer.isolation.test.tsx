// @vitest-environment jsdom
// IK74TX 6.1：Tab 完全隔离——素材与视频模型选择各自独立，切换不共享、不清空。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// jsdom 无 createObjectURL/revokeObjectURL，stub 供 handleFileChange/removeMedia 使用。
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock");
  URL.revokeObjectURL = vi.fn();
});

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

function uploadFiles(files: File[]) {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("file input not found");
  fireEvent.change(input, { target: { files } });
}

describe("AgentComposer tab isolation (IK74TX 6.1)", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("image-a", "Image A", ["16:9"]),
    ]);
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "Video A", ["16:9"]),
      capability("video-b", "Video B", ["16:9"]),
    ]);
    vi.mocked(getTextModels).mockResolvedValue([
      capability("text-a", "Text A", ["16:9"]),
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("素材按 tab 隔离：图片 tab 上传后切到视频 tab 素材列表为空，切回仍在", async () => {
    render(<AgentComposer />);
    fireEvent.click(screen.getByRole("button", { name: "AI 图片" }));
    uploadFiles([
      new File(["x"], "a.png", { type: "image/png" }),
    ]);

    expect(await screen.findByText("Image 1")).toBeTruthy();

    // 切到 AI 视频 tab：素材为空（无 Image 1），显示空态上传按钮
    fireEvent.click(screen.getByRole("button", { name: "AI 视频" }));
    expect(screen.queryByText("Image 1")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "上传参考" }),
    ).toBeTruthy();

    // 切回 AI 图片 tab：素材保留（切换不清空）
    fireEvent.click(screen.getByRole("button", { name: "AI 图片" }));
    expect(await screen.findByText("Image 1")).toBeTruthy();
  });

  it("智能体与 AI 视频的视频模型选择各自独立", async () => {
    render(<AgentComposer />);

    // 智能体 tab（默认激活）选 Video B（第一个「选择模型」为视频模型下拉）
    const modelButtons = await screen.findAllByRole("button", {
      name: "选择模型",
    });
    fireEvent.click(modelButtons[0]);
    fireEvent.click(screen.getByRole("button", { name: "Video B" }));

    // 切到 AI 视频 tab：模型仍为默认首个（Video A），不受智能体 tab 选择污染
    fireEvent.click(screen.getByRole("button", { name: "AI 视频" }));
    expect(await screen.findByRole("button", { name: "模型" })).toHaveTextContent(
      "Video A",
    );

    // 切回智能体 tab：仍是 Video B
    fireEvent.click(screen.getByRole("button", { name: "视频智能体" }));
    const agentModelButtons = await screen.findAllByRole("button", {
      name: "选择模型",
    });
    expect(agentModelButtons[0]).toHaveTextContent("Video B");
  });
});
