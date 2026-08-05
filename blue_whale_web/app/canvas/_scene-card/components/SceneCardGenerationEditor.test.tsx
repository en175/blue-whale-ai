// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateSceneCard,
  getSceneCardGenerationPreset,
} from "@/lib/conversation";
import { getVideoModels } from "@/app/canvas/_canvas/api/generation";
import { saveSceneCardDraft } from "@/lib/scene-card-gen-draft";

import { SceneCardGenerationEditor } from "./SceneCardGenerationEditor";

vi.mock("@/lib/conversation", () => ({
  generateSceneCard: vi.fn(),
  getSceneCardGenerationPreset: vi.fn(),
}));

vi.mock("@/app/canvas/_canvas/api/generation", () => ({
  getVideoModels: vi.fn(),
}));

vi.mock("@/lib/command-identity", () => ({
  newCommandIdentity: () => "command-1",
}));

const DIGEST = `sha256:${"a".repeat(64)}`;

const preset = {
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

function capability(modelId: string, providerId: string) {
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
      first_last_frame: false,
      audio: false,
    },
    version: 7,
    digest: DIGEST,
  };
}

describe("SceneCardGenerationEditor 模型切换", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(getSceneCardGenerationPreset).mockResolvedValue(preset);
    vi.mocked(getVideoModels).mockResolvedValue([
      capability("video-a", "provider-a"),
      capability("video-b", "provider-b"),
    ]);
    vi.mocked(generateSceneCard).mockResolvedValue({
      scene_card_id: "10",
      generation_job_id: "20",
      record_id: "30",
      preset_version: 4,
    });
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
});
