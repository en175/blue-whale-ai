import { describe, expect, it } from "vitest";

import { frozenGenerationParametersSchema } from "./plan-message.js";
import {
  deriveVideoReferenceMode,
  sceneCardGenerationRecordViewSchema,
  sceneCardRegenerationRequestSchema,
} from "./scene-card-generation.js";

const digest = `sha256:${"a".repeat(64)}`;

const frozenVideo = frozenGenerationParametersSchema.parse({
  capability_type: "video",
  model_id: "doubao-seedance-1.0",
  provider_id: "doubao",
  size: "1280x720",
  aspect_ratio: "16:9",
  format: null,
  duration: 5,
  count: 1,
});

const capabilitySnapshot = {
  schema_version: 1 as const,
  capability_type: "video" as const,
  model_id: "doubao-seedance-1.0",
  provider_id: "doubao",
  row_version: 3,
  digest,
};

const baseRequest = {
  scene_card_id: "5001",
  base_scene_card_version: 1,
  base_preset_version: 1,
  parameters: frozenVideo,
  reference_mode: "text_to_video" as const,
  reference_assets: [],
  capability_snapshot_version: capabilitySnapshot,
};

const referenceAsset = {
  mention_id: "101",
  type: "asset" as const,
  role: "reference" as const,
  projection: {
    asset_type: "image" as const,
    mime: "image/png",
    size: "1024",
    width: 1280,
    height: 720,
    duration_ms: null,
    content_sha256: "asset-content",
  },
};

describe("SceneCardRegenerationRequest contract", () => {
  it("接受合规视频再生成请求", () => {
    const request = sceneCardRegenerationRequestSchema.parse(baseRequest);
    expect(request.scene_card_id).toBe("5001");
    expect(request.base_scene_card_version).toBe(1);
  });

  it("拒绝非正整数 base_scene_card_version（0）", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        base_scene_card_version: 0,
      }),
    ).toThrow();
  });

  it("拒绝非正整数 base_preset_version（负数）", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        base_preset_version: -1,
      }),
    ).toThrow();
  });

  it("拒绝缺 parameters 字段", () => {
    const { parameters: _omit, ...rest } = baseRequest;
    expect(() => sceneCardRegenerationRequestSchema.parse(rest)).toThrow();
  });

  it("拒绝媒体类型为 image 的再生成请求", () => {
    const imageParams = {
      ...frozenVideo,
      capability_type: "image" as const,
      duration: null,
    };
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        parameters: imageParams,
      }),
    ).toThrow();
  });

  it("拒绝缺时长的视频再生成请求", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        parameters: { ...frozenVideo, duration: null },
      }),
    ).toThrow();
  });

  it("拒绝 parameters 与冻结能力快照指向不同模型", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        parameters: { ...frozenVideo, model_id: "another-video-model" },
      }),
    ).toThrow(/冻结能力快照/);
  });

  it("拒绝非法 reference_mode", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "image_to_video",
      }),
    ).toThrow();
  });

  it("接受与尾帧角色一致的尾帧模式", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "last_frame",
        reference_assets: [{ ...referenceAsset, role: "last_frame" }],
      }),
    ).not.toThrow();
  });

  it("拒绝与素材角色派生结果不一致的 reference_mode", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "text_to_video",
        reference_assets: [{ ...referenceAsset, role: "first_frame" }],
      }),
    ).toThrow(/素材角色派生模式/);
  });

  it("拒绝重复首帧角色", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "first_frame",
        reference_assets: [
          { ...referenceAsset, role: "first_frame" },
          { ...referenceAsset, mention_id: "102", role: "first_frame" },
        ],
      }),
    ).toThrow(/首帧参考素材最多只能有一个/);
  });

  it("拒绝未知字段（strict）", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        extra: true,
      }),
    ).toThrow();
  });
});

describe("deriveVideoReferenceMode", () => {
  it.each([
    [[], "text_to_video"],
    [[{ ...referenceAsset, role: "first_frame" as const }], "first_frame"],
    [[{ ...referenceAsset, role: "last_frame" as const }], "last_frame"],
    [
      [
        { ...referenceAsset, role: "first_frame" as const },
        {
          ...referenceAsset,
          mention_id: "102",
          role: "last_frame" as const,
        },
      ],
      "first_and_last_frame",
    ],
  ] as const)("按素材角色派生 %s", (assets, expected) => {
    expect(deriveVideoReferenceMode([...assets])).toBe(expected);
  });
});

describe("SceneCardGenerationRecordView contract", () => {
  it("接受合规记录投影", () => {
    const view = sceneCardGenerationRecordViewSchema.parse({
      record_id: "8001",
      scene_card_id: "5001",
      summary_status: "generating",
      first_generation_job_id: "9001",
      plan_message_id: "1001",
    });
    expect(view.summary_status).toBe("generating");
  });

  it("拒绝非法 summary_status", () => {
    expect(() =>
      sceneCardGenerationRecordViewSchema.parse({
        record_id: "8001",
        scene_card_id: "5001",
        summary_status: "pending",
        first_generation_job_id: "9001",
        plan_message_id: "1001",
      }),
    ).toThrow();
  });

  it("拒绝缺 plan_message_id", () => {
    expect(() =>
      sceneCardGenerationRecordViewSchema.parse({
        record_id: "8001",
        scene_card_id: "5001",
        summary_status: "success",
        first_generation_job_id: "9001",
      }),
    ).toThrow();
  });
});
