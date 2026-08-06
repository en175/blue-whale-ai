// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStoryboardPreview,
  generateSceneCard,
  getSceneCardGenerationPreset,
  type SceneCardGenerationPreset,
} from "@/lib/conversation";
import type { ProviderPromptAsset } from "@blue-whale/contracts";
import {
  getImageModels,
  getVideoModels,
} from "@/app/canvas/_canvas/api/generation";
import { saveSceneCardDraft } from "@/lib/scene-card-gen-draft";

import { SceneCardGenerationEditor } from "./SceneCardGenerationEditor";

vi.mock("@/lib/conversation", () => ({
  createStoryboardPreview: vi.fn(),
  generateSceneCard: vi.fn(),
  getSceneCardGenerationPreset: vi.fn(),
}));

vi.mock("@/app/canvas/_canvas/api/generation", () => ({
  getImageModels: vi.fn(),
  getVideoModels: vi.fn(),
}));

vi.mock("@/lib/command-identity", () => ({
  newCommandIdentity: () => "command-1",
}));

const DIGEST = `sha256:${"a".repeat(64)}`;

const referenceAssets: ProviderPromptAsset[] = [
  {
    mention_id: "101",
    type: "asset" as const,
    role: "reference" as const,
    projection: {
      asset_type: "image",
      mime: "image/png",
      size: "1024",
      width: 1280,
      height: 720,
      duration_ms: null,
      content_sha256: "asset-a",
    },
  },
  {
    mention_id: "102",
    type: "asset" as const,
    role: "reference" as const,
    projection: {
      asset_type: "image",
      mime: "image/png",
      size: "2048",
      width: 1280,
      height: 720,
      duration_ms: null,
      content_sha256: "asset-b",
    },
  },
];

const preset: SceneCardGenerationPreset = {
  scene_card: {
    scene_card_id: "10",
    version: 2,
    title: "雨夜追车",
    content_markdown: "一辆车穿过雨夜。",
  },
  preset: {
    version: 3,
    parameters: {
      model_id: "video-a",
      aspect_ratio: "16:9",
      size: "720p",
      duration: 6,
      count: 1,
    },
    reference_mode: "text_to_video",
    reference_assets: [],
    capability_snapshot_version: {
      schema_version: 1,
      capability_type: "video",
      model_id: "video-a",
      provider_id: "provider-a",
      row_version: 7,
      digest: DIGEST,
    },
  },
  projection: null,
};

function capability(
  modelId: string,
  providerId: string,
  featureOverrides: Record<string, boolean | number> = {},
) {
  return {
    model_id: modelId,
    provider_id: providerId,
    model_label: modelId === "video-a" ? "模型 A" : "模型 B",
    icon: null,
    supported_sizes: [
      {
        id: "720p",
        label: "720P",
        api_value: "720p",
        width: 1280,
        height: 720,
      },
    ],
    supported_aspect_ratios: ["16:9"],
    supported_formats: ["mp4"],
    supported_durations: { min: 3, max: 9, step: 3 },
    default_size: "720p",
    default_format: "mp4",
    default_aspect_ratio: "16:9",
    default_duration: 6,
    features: {
      reference_image: false,
      max_reference_images: 0,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: false,
      last_frame: false,
      first_last_frame: false,
      audio: false,
      ...featureOverrides,
    },
    version: 7,
    digest: DIGEST,
  };
}

function imageCapability() {
  return {
    ...capability("image-a", "image-provider"),
    model_label: "图片模型 A",
    supported_sizes: [
      {
        id: "2k",
        label: "2K",
        api_value: "2k",
        width: 2048,
        height: 1152,
      },
    ],
    supported_formats: ["png"],
    supported_durations: null,
    default_size: "2k",
    default_format: "png",
    default_duration: null,
    features: {
      ...capability("image-a", "image-provider").features,
      quantity_max: 4,
    },
  };
}

describe("SceneCardGenerationEditor", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue(preset);
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a"),
      capability("video-b", "provider-b"),
    ]);
    vi.mocked(getImageModels).mockResolvedValue([imageCapability()]);
    vi.mocked(generateSceneCard).mockResolvedValue({
      scene_card_id: "10",
      generation_job_id: "20",
      record_id: "30",
      preset_version: 4,
    });
    vi.mocked(createStoryboardPreview).mockResolvedValue({
      preview_id: "40",
      scene_card_id: "10",
      generation_job_id: "50",
    });
  });

  it("从已批准的生成方式菜单显式触发四格分镜预览", async () => {
    const onClose = vi.fn();
    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={onClose}
      />,
    );

    await screen.findByRole("combobox", { name: "模型" });
    fireEvent.click(screen.getByRole("button", { name: "更多生成方式" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "先预览分镜图" }));

    await waitFor(() =>
      expect(createStoryboardPreview).toHaveBeenCalledTimes(1),
    );
    expect(vi.mocked(createStoryboardPreview).mock.calls[0]?.[3]).toEqual({
      scene_card_id: "10",
      base_scene_card_version: 2,
      parameters: {
        model_id: "image-a",
        size: "2k",
        aspect_ratio: "16:9",
        count: 4,
      },
      capability_snapshot_version: {
        schema_version: 1,
        capability_type: "image",
        model_id: "image-a",
        provider_id: "image-provider",
        row_version: 7,
        digest: DIGEST,
      },
    });
    expect(generateSceneCard).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("能力版本与摘要一致时切换模型，并提交所选模型的新快照", async () => {
    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    const modelSelect = await screen.findByRole("combobox", { name: "模型" });
    expect(modelSelect).toHaveValue("video-a");

    fireEvent.change(modelSelect, { target: { value: "video-b" } });
    expect(modelSelect).toHaveValue("video-b");
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(generateSceneCard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(generateSceneCard).mock.calls[0]?.[3]).toMatchObject({
      parameters: { model_id: "video-b" },
      capability_snapshot_version: {
        schema_version: 1,
        capability_type: "video",
        model_id: "video-b",
        provider_id: "provider-b",
        row_version: 7,
        digest: DIGEST,
      },
    });
  });

  it("能力版本或摘要漂移时保持原模型并提示重新确认参数", async () => {
    const drifted = capability("video-b", "provider-b");
    drifted.version = 8;
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a"),
      drifted,
    ]);

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    const modelSelect = await screen.findByRole("combobox", { name: "模型" });
    fireEvent.change(modelSelect, { target: { value: "video-b" } });

    expect(modelSelect).toHaveValue("video-a");
    expect(
      screen.getByText(
        "模型能力与首次冻结快照不一致，未切换；请重新确认生成参数。",
      ),
    ).toBeInTheDocument();
    expect(generateSceneCard).not.toHaveBeenCalled();
  });

  it("恢复草稿时重新校验已切换模型，漂移则回退原模型并提示", async () => {
    const drifted = capability("video-b", "provider-b");
    drifted.version = 8;
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a"),
      drifted,
    ]);
    saveSceneCardDraft("10", {
      baseSceneCardVersion: 2,
      basePresetVersion: 3,
      overrides: {
        model_id: "video-b",
        aspect_ratio: "16:9",
        size: "720p",
        duration: 6,
        count: 1,
        reference_mode: "text_to_video",
      },
      updatedAt: "2026-08-05T00:00:00.000Z",
    });

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    const modelSelect = await screen.findByRole("combobox", { name: "模型" });
    expect(modelSelect).toHaveValue("video-a");
    expect(
      screen.getByText(
        "模型能力与首次冻结快照不一致，未切换；请重新确认生成参数。",
      ),
    ).toBeInTheDocument();
  });

  it("尾帧参考模式只由独立 last_frame 能力控制", async () => {
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a", {
        first_frame: false,
        last_frame: true,
      }),
    ]);

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    await screen.findByRole("combobox", { name: "参考模式" });
    expect(
      screen.queryByRole("option", { name: "首帧" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "尾帧" })).toBeInTheDocument();
  });

  it("已有引用素材显示可编辑的角色选择", async () => {
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue({
      ...preset,
      preset: {
        ...preset.preset,
        reference_assets: referenceAssets,
      },
    });

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("combobox", { name: "参考素材 1 角色" }),
    ).toHaveValue("reference");
    expect(
      screen.getByRole("combobox", { name: "参考素材 2 角色" }),
    ).toHaveValue("reference");
  });

  it("修改素材角色时自动派生参考模式，并保证首尾帧角色各自唯一", async () => {
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue({
      ...preset,
      preset: {
        ...preset.preset,
        reference_assets: referenceAssets,
      },
    });
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a", {
        first_frame: true,
        last_frame: true,
        first_last_frame: true,
      }),
    ]);

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    const firstRole = await screen.findByRole("combobox", {
      name: "参考素材 1 角色",
    });
    const secondRole = screen.getByRole("combobox", {
      name: "参考素材 2 角色",
    });
    const referenceMode = screen.getByRole("combobox", {
      name: "参考模式",
    });

    fireEvent.change(firstRole, { target: { value: "first_frame" } });
    expect(referenceMode).toHaveValue("first_frame");

    fireEvent.change(secondRole, { target: { value: "last_frame" } });
    expect(referenceMode).toHaveValue("first_and_last_frame");

    fireEvent.change(secondRole, { target: { value: "first_frame" } });
    expect(firstRole).toHaveValue("reference");
    expect(secondRole).toHaveValue("first_frame");
    expect(referenceMode).toHaveValue("first_frame");
  });

  it("生成时提交编辑后的素材角色和派生参考模式", async () => {
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue({
      ...preset,
      preset: {
        ...preset.preset,
        reference_assets: referenceAssets,
      },
    });
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a", {
        first_frame: true,
        last_frame: true,
        first_last_frame: true,
      }),
    ]);

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(
      await screen.findByRole("combobox", { name: "参考素材 1 角色" }),
      { target: { value: "first_frame" } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "参考素材 2 角色" }),
      { target: { value: "last_frame" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "生成" }));

    await waitFor(() => expect(generateSceneCard).toHaveBeenCalledTimes(1));
    expect(vi.mocked(generateSceneCard).mock.calls[0]?.[3]).toMatchObject({
      reference_mode: "first_and_last_frame",
      reference_assets: [
        { mention_id: "101", role: "first_frame" },
        { mention_id: "102", role: "last_frame" },
      ],
    });
  });

  it("刷新后恢复草稿中的素材角色", async () => {
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue({
      ...preset,
      preset: {
        ...preset.preset,
        reference_assets: referenceAssets,
      },
    });
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a", { first_frame: true }),
    ]);
    saveSceneCardDraft("10", {
      baseSceneCardVersion: 2,
      basePresetVersion: 3,
      overrides: {
        model_id: "video-a",
        aspect_ratio: "16:9",
        size: "720p",
        duration: 6,
        count: 1,
        reference_mode: "first_frame",
        reference_assets: [
          { ...referenceAssets[0], role: "first_frame" },
          referenceAssets[1],
        ],
      },
      updatedAt: "2026-08-05T00:00:00.000Z",
    });

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("combobox", { name: "参考素材 1 角色" }),
    ).toHaveValue("first_frame");
    expect(screen.getByRole("combobox", { name: "参考模式" })).toHaveValue(
      "first_frame",
    );
  });

  it("派生模式不受模型支持时禁用生成，补齐首尾帧后恢复", async () => {
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue({
      ...preset,
      preset: {
        ...preset.preset,
        reference_assets: referenceAssets,
      },
    });
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a", { first_last_frame: true }),
    ]);

    render(
      <SceneCardGenerationEditor
        projectId="1"
        sceneCardId="10"
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(
      await screen.findByRole("combobox", { name: "参考素材 1 角色" }),
      { target: { value: "first_frame" } },
    );
    expect(screen.getByText("当前模型不支持首帧参考模式")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成" })).toBeDisabled();

    fireEvent.change(
      screen.getByRole("combobox", { name: "参考素材 2 角色" }),
      { target: { value: "last_frame" } },
    );
    expect(
      screen.queryByText("当前模型不支持首帧参考模式"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "参考模式" })).toHaveValue(
      "first_and_last_frame",
    );
    expect(screen.getByRole("button", { name: "生成" })).toBeEnabled();
  });
});
