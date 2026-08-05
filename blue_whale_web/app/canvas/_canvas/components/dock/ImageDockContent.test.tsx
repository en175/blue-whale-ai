// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getImageModels } from "../../api/generation";
import { toast } from "@/components/Toast";
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

describe("ImageDockContent 参考图上限（IK5OWU）", () => {
  beforeEach(() => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
    ]);
  });

  it("达上限时上传入口禁用", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
        referenceCount={4}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );

    const plusBtn = screen.getByRole("button", { name: "上传图片" });
    expect(plusBtn).toBeDisabled();
  });

  it("未达上限时上传入口可用", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
        referenceCount={3}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );

    const plusBtn = screen.getByRole("button", { name: "上传图片" });
    expect(plusBtn).not.toBeDisabled();
  });

  it("切模型时 onMaxReferenceImagesChange 联动新上限", async () => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
      {
        ...capability("pro", "Pro 模型", {
          tools: false,
          sequential_image_generation: false,
        }),
        features: {
          reference_image: true,
          max_reference_images: 10,
          watermark: false,
          quantity_max: 4,
          stream: false,
          tools: false,
          first_frame: false,
          first_last_frame: false,
          audio: false,
          sequential_image_generation: false,
        },
      },
    ]);

    const onMaxChange = vi.fn();
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
        onMaxReferenceImagesChange={onMaxChange}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    expect(onMaxChange).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole("button", { name: "图像模型设置" }));
    // 点击模型下拉触发器展开模型列表
    fireEvent.click(screen.getAllByRole("button", { name: "完整能力模型" })[0]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pro 模型" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pro 模型" }));

    await waitFor(() => expect(onMaxChange).toHaveBeenCalledWith(10));
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
        onGenerate={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "放大面板" }),
    ).toBeInTheDocument();
  });

  it("点击放大按钮 → 触发 onToggleExpand", async () => {
    const onToggleExpand = vi.fn();
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
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

  it("放大态：切换按钮显示收起", async () => {
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
        expanded
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "收起面板" }),
    ).toBeInTheDocument();
  });
});

describe("ImageDockContent 上传入口可用性（修复入口消失）", () => {
  it("能力表未就绪（接口返回空）时上传入口仍显示，避免『图片引入不进来』", async () => {
    vi.mocked(getImageModels).mockResolvedValue([]);
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    // 空列表 → selectedModel 保持 null → 乐观显示上传入口（占位 + 底部加号）
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upload reference image" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "上传图片" }),
    ).toBeInTheDocument();
  });

  it("media 非空时缩略图行末尾显示『继续添加图片』并弹上传来源菜单", async () => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("capable", "完整能力模型", {
        tools: true,
        sequential_image_generation: true,
      }),
    ]);
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
        onRemoveMedia={vi.fn()}
        media={[
          {
            id: "m1",
            type: "image",
            name: "参考图.png",
            src: "blob:preview-1",
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("完整能力模型")).toBeInTheDocument(),
    );
    const addBtn = screen.getByRole("button", { name: "继续添加图片" });
    expect(addBtn).toBeInTheDocument();
    fireEvent.click(addBtn);
    expect(screen.getByRole("menu", { name: "上传来源" })).toBeInTheDocument();
  });

  it("能力表就绪后模型不支持参考图时入口收敛隐藏", async () => {
    vi.mocked(getImageModels).mockResolvedValue([
      capability("basic", "基础模型", {
        tools: false,
        sequential_image_generation: false,
        reference_image: false,
      }),
    ]);
    render(
      <ImageDockContent
        editorRef={createRef<HTMLDivElement>()}
        isEmpty={false}
        onInput={vi.fn()}
        onGenerate={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText("基础模型")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Upload reference image" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "上传图片" })).toBeNull();
  });

  it("能力表拉取失败时 toast 提示（IK6M68，避免静默黑洞）", async () => {
    const messages: string[] = [];
    const unsubscribe = toast.subscribe((items) =>
      messages.push(...items.map((t) => t.message)),
    );
    try {
      vi.mocked(getImageModels).mockRejectedValue(new Error("boom"));
      render(
        <ImageDockContent
          editorRef={createRef<HTMLDivElement>()}
          isEmpty={false}
          onInput={vi.fn()}
          onGenerate={vi.fn()}
        />,
      );

      await waitFor(() =>
        expect(messages).toContain("模型能力加载失败，请刷新重试"),
      );
    } finally {
      unsubscribe();
    }
  });
});
