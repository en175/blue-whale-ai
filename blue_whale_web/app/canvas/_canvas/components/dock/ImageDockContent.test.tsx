// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getImageModels } from "../../api/generation";
import { ImageDockContent } from "./ImageDockContent";

vi.mock("../../api/generation", () => ({
  getImageModels: vi.fn(),
}));

const capability = (
  id: string,
  label: string,
  features: {
    tools: boolean;
    sequential_image_generation: boolean;
    reference_image?: boolean;
  },
) => ({
  model_id: id,
  provider_id: "volc",
  model_label: label,
  icon: null,
  supported_sizes: [{ id: "2k", label: "2K", api_value: "2K" }],
  supported_aspect_ratios: ["1:1"],
  supported_formats: ["png"],
  supported_durations: null,
  default_size: "2k",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
  features: {
    reference_image: true,
    max_reference_images: 4,
    watermark: false,
    quantity_max: 4,
    stream: false,
    first_frame: false,
    first_last_frame: false,
    audio: false,
    ...features,
  },
});

describe("ImageDockContent model capability changes", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
      capability("basic", "基础模型", {
        tools: false,
        sequential_image_generation: false,
        reference_image: false,
      }),
    ]);
  });

  it("clears enabled options when the next model does not support them", async () => {
    const onGenerate = vi.fn();
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onClose={vi.fn()}
        onGenerate={onGenerate}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "图像模型设置" }));
    fireEvent.click(screen.getByRole("switch", { name: "联网搜索" }));
    fireEvent.click(screen.getByRole("switch", { name: "组图模式" }));
    fireEvent.click(screen.getByRole("button", { name: "完整能力模型" }));
    fireEvent.click(screen.getByRole("button", { name: "基础模型" }));
    fireEvent.click(screen.getByRole("button", { name: /生成$/ }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "basic",
        webSearch: false,
        sequential: false,
        referenceImageSupported: false,
      }),
    );
  });
});

describe("ImageDockContent portal 浮层携带 data-tc-dock-popover（IK5OWS 例外②）", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
    ]);
  });

  it("数量菜单 portal 根节点带 data-tc-dock-popover", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "生成数量" }));

    const menu = document.querySelector("[data-tc-dock-popover]");
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("role")).toBe("listbox");
  });
});

describe("ImageDockContent 放大按钮（IK5OWV）", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
    ]);
  });

  it("普通态：放大按钮存在，X 关闭按钮存在", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "放大面板" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("点击放大按钮 → 触发 onToggleExpand", async () => {
    const onToggleExpand = vi.fn();
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
        onToggleExpand={onToggleExpand}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "放大面板" }));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
  });

  it("放大态：X 关闭按钮隐藏，切换按钮显示收起", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onClose={vi.fn()}
        onGenerate={vi.fn()}
        expanded
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "收起面板" }),
    ).toBeInTheDocument();
  });
});
