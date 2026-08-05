import { describe, expect, it } from "vitest";

import {
  planApplicationReceiptSchema,
  sceneCardGenerationPresetSchema,
  sceneCardGenerationRecordSchema,
} from "./plan-application.js";
import { frozenGenerationParametersSchema } from "./plan-message.js";

const digest = `sha256:${"a".repeat(64)}`;

const receiptBase = {
  message_id: "1001",
  content_digest: digest,
  applied_at: "2026-08-05T08:00:00+08:00",
  first_generation_job_id: "9001",
  command_id: "cmd-abc",
};

const videoReceiptFields = {
  scene_card_id: "5001",
  result_version: 1,
  preset_digest: digest,
};

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

describe("PlanApplicationReceipt contract", () => {
  it("接受 scene_card_create 视频回执（带 scene_card_id + 版本 + 预设摘要）", () => {
    const receipt = planApplicationReceiptSchema.parse({
      ...receiptBase,
      ...videoReceiptFields,
      application_kind: "scene_card_create",
    });
    expect(receipt.application_kind).toBe("scene_card_create");
    expect(receipt.scene_card_id).toBe("5001");
  });

  it("image_generate 分支禁止携带 scene_card_id（CONTEXT _Avoid_ L208）", () => {
    expect(() =>
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        application_kind: "image_generate",
        scene_card_id: "5001",
      }),
    ).toThrow();
    // 干净的 image_generate（无 scene_card_id）应通过，留给 T10 实例化。
    expect(
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        application_kind: "image_generate",
      }).application_kind,
    ).toBe("image_generate");
  });

  it("scene_card_create 缺 scene_card_id 抛错", () => {
    expect(() =>
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        application_kind: "scene_card_create",
      }),
    ).toThrow();
  });

  it("scene_card_replace 额外必填 target_scene_card_mention_id（为 T12 预留）", () => {
    expect(() =>
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        ...videoReceiptFields,
        application_kind: "scene_card_replace",
      }),
    ).toThrow();
    expect(
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        ...videoReceiptFields,
        application_kind: "scene_card_replace",
        target_scene_card_mention_id: "202",
      }).application_kind,
    ).toBe("scene_card_replace");
  });

  it("非法 application_kind 抛错", () => {
    expect(() =>
      planApplicationReceiptSchema.parse({
        ...receiptBase,
        ...videoReceiptFields,
        application_kind: "create",
      }),
    ).toThrow();
  });
});

describe("SceneCardGenerationPreset contract", () => {
  const basePreset = {
    scene_card_id: "5001",
    parameters: frozenVideo,
    reference_mode: "text_to_video" as const,
    reference_assets: [],
    capability_snapshot_version: {
      schema_version: 1 as const,
      capability_type: "video" as const,
      model_id: "doubao-seedance-1.0",
      provider_id: "doubao",
      row_version: 3,
      digest,
    },
  };

  it("接受合规视频预设（必有时长与视频参考模式）", () => {
    const preset = sceneCardGenerationPresetSchema.parse(basePreset);
    expect(preset.reference_mode).toBe("text_to_video");
  });

  it("拒绝媒体类型为 image 的预设（CONTEXT L54 媒体类型固定为视频）", () => {
    const imageParams = {
      ...frozenVideo,
      capability_type: "image" as const,
      duration: null,
    };
    expect(() =>
      sceneCardGenerationPresetSchema.parse({
        ...basePreset,
        parameters: imageParams,
      }),
    ).toThrow();
  });

  it("拒绝缺时长的视频预设（CONTEXT L55 必有时长）", () => {
    expect(() =>
      sceneCardGenerationPresetSchema.parse({
        ...basePreset,
        parameters: { ...frozenVideo, duration: null },
      }),
    ).toThrow();
  });
});

describe("SceneCardGenerationRecord contract", () => {
  it("汇总状态只允许 generating/partial/success/failed", () => {
    for (const status of ["generating", "partial", "success", "failed"] as const) {
      expect(
        sceneCardGenerationRecordSchema.parse({
          scene_card_id: "5001",
          summary_status: status,
          plan_message_id: "1001",
          application_receipt_id: "7001",
          first_generation_job_id: "9001",
        }).summary_status,
      ).toBe(status);
    }
    expect(() =>
      sceneCardGenerationRecordSchema.parse({
        scene_card_id: "5001",
        summary_status: "pending",
        plan_message_id: "1001",
        application_receipt_id: "7001",
        first_generation_job_id: "9001",
      }),
    ).toThrow();
  });
});
