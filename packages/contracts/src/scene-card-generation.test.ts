import { describe, expect, it } from "vitest";

import { frozenGenerationParametersSchema } from "./plan-message.js";
import {
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

  it("拒绝非法 reference_mode", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "image_to_video",
      }),
    ).toThrow();
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
