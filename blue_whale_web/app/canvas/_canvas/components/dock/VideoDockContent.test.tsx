// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoDockContentProps } from "../../types";
import { VideoDockContent } from "./VideoDockContent";

vi.mock("../../api/generation", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getVideoModels: vi.fn() };
});
import { getVideoModels } from "../../api/generation";

expect.extend(jestDomMatchers);

function props(
  overrides: Partial<VideoDockContentProps> = {},
): VideoDockContentProps {
  return {
    editorRef: createRef<HTMLDivElement>(),
    isEmpty: false,
    onInput: vi.fn(),
    onClose: vi.fn(),
    refMode: { id: "omni", label: "全能参考" },
    setRefMode: vi.fn(),
    refModeOpen: false,
    setRefModeOpen: vi.fn(),
    selectedModel: { id: "seedance-2", label: "Seedance 2.0" },
    setSelectedModel: vi.fn(),
    modelSettingsOpen: false,
    setModelSettingsOpen: vi.fn(),
    aspectRatio: { id: "16:9", label: "16:9" },
    setAspectRatio: vi.fn(),
    resolution: { id: "720p", label: "720p" },
    setResolution: vi.fn(),
    duration: 8,
    setDuration: vi.fn(),
    quantity: "1x",
    setQuantity: vi.fn(),
    quantityOpen: false,
    setQuantityOpen: vi.fn(),
    advancedOpen: false,
    setAdvancedOpen: vi.fn(),
    internetSearch: false,
    setInternetSearch: vi.fn(),
    models: [{ id: "seedance-2", label: "Seedance 2.0" }],
    ...overrides,
  };
}

describe("VideoDockContent references", () => {
  afterEach(() => cleanup());

  it("视频参考按钮与图片一致：弹「上传来源」菜单，本地上传走 MP4/MOV", () => {
    const onLocalUpload = vi.fn();
    const { container } = render(
      <VideoDockContent {...props({ onLocalUpload })} />,
    );

    expect(screen.queryByRole("button", { name: "音频" })).toBeNull();
    // 点视频按钮先弹菜单（和图片入口一致），再选「本地上传」
    fireEvent.click(screen.getByRole("button", { name: "参考视频" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "本地上传" }));

    const input = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).find((candidate) => candidate.accept.includes("video/quicktime"));
    expect(input?.accept).toBe(".mp4,.mov,video/mp4,video/quicktime");

    const file = new File(["video"], "reference.mov", {
      type: "video/quicktime",
    });
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onLocalUpload).toHaveBeenCalledWith(file);
  });

  it("视频参考按钮支持从画布选择（与图片入口对齐）", () => {
    const onPickFromCanvas = vi.fn();
    render(<VideoDockContent {...props({ onPickFromCanvas })} />);

    fireEvent.click(screen.getByRole("button", { name: "参考视频" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从画布选择" }));

    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
  });

  it("时长滑块按模型 supported_durations 驱动（min/max/step 来自能力表，非硬编码）", async () => {
    vi.mocked(getVideoModels).mockResolvedValue([
      {
        model_id: "seedance-2",
        provider_id: "volcengine",
        model_label: "Seedance 2.0",
        icon: null,
        supported_sizes: [
          {
            id: "720p",
            label: "720p",
            api_value: "720p",
            width: undefined,
            height: undefined,
          },
        ],
        supported_aspect_ratios: ["16:9"],
        supported_formats: [],
        supported_durations: { min: 3, max: 9, step: 3 },
        default_size: "720p",
        default_format: null,
        default_aspect_ratio: "16:9",
        default_duration: 6,
        features: {
          reference_image: true,
          max_reference_images: 0,
          watermark: false,
          quantity_max: 1,
          sequential_image_generation: false,
          stream: false,
          tools: false,
          first_frame: true,
          first_last_frame: true,
          audio: true,
        },
      },
    ]);
    render(
      <VideoDockContent
        {...props({ modelSettingsOpen: true })}
        models={undefined}
      />,
    );

    await vi.waitFor(() => {
      const slider = screen.getByRole("slider", { name: "时长" });
      expect(slider).toHaveAttribute("min", "3");
      expect(slider).toHaveAttribute("max", "9");
      expect(slider).toHaveAttribute("step", "3");
    });
  });

  it("offers canvas selection from the video reference source menu", () => {
    const onPickFromCanvas = vi.fn();
    render(<VideoDockContent {...props({ onPickFromCanvas })} />);

    fireEvent.click(screen.getByRole("button", { name: "参考图片" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从画布选择" }));

    expect(onPickFromCanvas).toHaveBeenCalledTimes(1);
  });

  it("only exposes model-supported options and quantity", () => {
    render(
      <VideoDockContent
        {...props({
          selectedModel: {
            id: "doubao-seedance-2-0-fast-260128",
            label: "Seedance 2.0 Fast",
          },
          models: [
            {
              id: "doubao-seedance-2-0-fast-260128",
              label: "Seedance 2.0 Fast",
            },
          ],
          resolutions: [{ id: "480p", label: "480p" }],
          aspectRatios: [{ id: "9:16", label: "9:16" }],
          quantityMax: 1,
          quantityOpen: true,
        })}
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "1x" })).toBeInTheDocument();
  });
});
