import { describe, expect, it } from "vitest";

import {
  deriveProviderPromptProjection,
  frozenGenerationParametersSchema,
  planApplicationAvailabilitySchema,
  planApplicationKindSchema,
  planApplyImageReceiptSchema,
  planCardCandidateSchema,
} from "./plan-message.js";

const digest = `sha256:${"a".repeat(64)}`;

const frozenImage = frozenGenerationParametersSchema.parse({
  capability_type: "image",
  model_id: "doubao-seedream-5.0-lite",
  provider_id: "doubao",
  size: "1024x1024",
  aspect_ratio: "1:1",
  format: "png",
  duration: null,
  count: 1,
});

describe("PlanMessage contract", () => {
  it("把 PlanApplicationKind 固定为三种判别值", () => {
    expect(planApplicationKindSchema.parse("image_generate")).toBe(
      "image_generate",
    );
    expect(planApplicationKindSchema.parse("scene_card_create")).toBe(
      "scene_card_create",
    );
    expect(planApplicationKindSchema.parse("scene_card_replace")).toBe(
      "scene_card_replace",
    );
    expect(() => planApplicationKindSchema.parse("create")).toThrow();
  });

  it("接受 image_generate 卡，拒绝非 replace 卡携带 target 字段", () => {
    expect(
      planCardCandidateSchema.parse({
        application_kind: "image_generate",
        title: "海报主视觉",
        content_markdown: "一只冲浪的蓝鲸 asset://101",
      }).application_kind,
    ).toBe("image_generate");
    expect(() =>
      planCardCandidateSchema.parse({
        application_kind: "image_generate",
        title: "海报主视觉",
        content_markdown: "一只冲浪的蓝鲸",
        target_scene_card_mention_id: "101",
        base_scene_card_version: 1,
      }),
    ).toThrow();
  });

  it("强制 scene_card_replace 必填 target 句柄（base 版本由 commit 解析）", () => {
    expect(() =>
      planCardCandidateSchema.parse({
        application_kind: "scene_card_replace",
        title: "覆盖分镜",
        content_markdown: "覆盖 asset://202",
      }),
    ).toThrow();
    expect(
      planCardCandidateSchema.parse({
        application_kind: "scene_card_replace",
        title: "覆盖分镜",
        content_markdown: "覆盖 asset://202",
        target_scene_card_mention_id: "202",
      }).application_kind,
    ).toBe("scene_card_replace");
  });

  it("deriveProviderPromptProjection 不改写正文，未指定帧时角色为 reference", () => {
    const projection = deriveProviderPromptProjection({
      content_markdown: "一只冲浪的蓝鲸 asset://101",
      derived_references: [
        {
          mention_id: "101",
          mention_seq: 0,
          type: "asset",
          first_seen_offset: 9,
          projection: {
            asset_type: "image/png",
            mime: "image/png",
            size: "12345",
            width: 1024,
            height: 1024,
            duration_ms: null,
            content_sha256: null,
          },
        },
      ],
      frozen_generation_parameters: frozenImage,
    });
    // AC#7：prompt_text 必须是权威 Markdown 原文，不改写、不调第二模型。
    expect(projection.prompt_text).toBe("一只冲浪的蓝鲸 asset://101");
    expect(projection.reference_assets[0].role).toBe("reference");
    expect(projection.parameters).toEqual(frozenImage);
  });

  it("deriveProviderPromptProjection 按首/尾帧 mention_seq 反查角色", () => {
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
    const projection = deriveProviderPromptProjection({
      content_markdown: "首帧 asset://301 尾帧 asset://302",
      derived_references: [
        {
          mention_id: "301",
          mention_seq: 0,
          type: "asset",
          first_seen_offset: 3,
          projection: {
            asset_type: "image/png",
            mime: "image/png",
            size: "1",
            width: 1,
            height: 1,
            duration_ms: null,
            content_sha256: null,
          },
        },
        {
          mention_id: "302",
          mention_seq: 1,
          type: "asset",
          first_seen_offset: 10,
          projection: {
            asset_type: "image/png",
            mime: "image/png",
            size: "1",
            width: 1,
            height: 1,
            duration_ms: null,
            content_sha256: null,
          },
        },
      ],
      frozen_generation_parameters: frozenVideo,
      first_frame_mention_seq: 0,
      last_frame_mention_seq: 1,
    });
    expect(projection.reference_assets[0].role).toBe("first_frame");
    expect(projection.reference_assets[1].role).toBe("last_frame");
  });
});

const receiptCommon = {
  receipt_id: "9001",
  plan_message_id: "123",
  project_id: "456",
  conversation_id: "789",
  agent_run_id: "1001",
  first_generation_job_id: "2002",
  content_digest: digest,
  applied_at: "2026-08-05T10:00:00.000Z",
};

describe("PlanApplicationReceipt contract", () => {
  it("image_generate 分支 scene_card_id 恒为 null", () => {
    const receipt = planApplyImageReceiptSchema.parse({
      ...receiptCommon,
      application_kind: "image_generate",
      scene_card_id: null,
    });
    expect(receipt.application_kind).toBe("image_generate");
    expect(receipt.scene_card_id).toBeNull();
  });

  it("image 分支拒绝携带 scene_card_id（strict）", () => {
    expect(() =>
      planApplyImageReceiptSchema.parse({
        ...receiptCommon,
        application_kind: "image_generate",
        scene_card_id: "500",
      }),
    ).toThrow();
  });

  it("video 分支预留 scene 字段（nullable，T11/T12 不填）", () => {
    const receipt = planApplyImageReceiptSchema.parse({
      ...receiptCommon,
      application_kind: "scene_card_create",
      scene_card_id: null,
      result_scene_card_version: null,
      generation_preset_digest: null,
    });
    expect(receipt.application_kind).toBe("scene_card_create");
    expect(receipt.scene_card_id).toBeNull();
  });

  it("PlanApplicationAvailability 固定三态，拒绝未知值", () => {
    expect(planApplicationAvailabilitySchema.parse("available")).toBe(
      "available",
    );
    expect(planApplicationAvailabilitySchema.parse("retryable_blocked")).toBe(
      "retryable_blocked",
    );
    expect(planApplicationAvailabilitySchema.parse("requires_new_plan")).toBe(
      "requires_new_plan",
    );
    expect(() =>
      planApplicationAvailabilitySchema.parse("unknown"),
    ).toThrow();
  });
});
