import { describe, expect, it } from "vitest";

import {
  capabilitySnapshotVersionSchema,
  derivedReferenceSchema,
  frozenGenerationParametersSchema,
  providerPromptAssetSchema,
} from "./plan-message.js";

// IKCKOW / IKD806 退役了内嵌 Agent 运行时与计划应用写路径，本文件原先覆盖的
// PlanMessage / PlanCardCandidate / PlanApplyImageReceipt / ProviderPromptProjection /
// deriveProviderPromptProjection / PlanApplicationAvailability 已随那条通道删除。
// 留下的四项仍被别处真实消费，这里补上它们自己的契约覆盖（改之前这四项没有直接用例）。

const digest = `sha256:${"a".repeat(64)}`;

const ASSET_PROJECTION = {
  asset_type: "image/png",
  mime: "image/png",
  size: "12345",
  width: 1024,
  height: 1024,
  duration_ms: null,
  content_sha256: null,
};

describe("plan-message 存活契约（能力快照 / 派生引用 / 冻结参数 / 引用素材）", () => {
  it("capabilitySnapshotVersion 固定 schema_version=1 且 digest 必须是 sha256 形态", () => {
    expect(
      capabilitySnapshotVersionSchema.parse({
        schema_version: 1,
        capability_type: "video",
        model_id: "doubao-seedance-1.0",
        provider_id: "doubao",
        row_version: 3,
        digest,
      }).row_version,
    ).toBe(3);
    expect(() =>
      capabilitySnapshotVersionSchema.parse({
        schema_version: 2,
        capability_type: "video",
        model_id: "m",
        provider_id: "p",
        row_version: 3,
        digest,
      }),
    ).toThrow();
    expect(() =>
      capabilitySnapshotVersionSchema.parse({
        schema_version: 1,
        capability_type: "audio",
        model_id: "m",
        provider_id: "p",
        row_version: 3,
        digest,
      }),
    ).toThrow();
  });

  it("derivedReference 按 type 判别，且 mention_id 必须是非零十进制串", () => {
    expect(
      derivedReferenceSchema.parse({
        mention_id: "101",
        mention_seq: 0,
        type: "asset",
        first_seen_offset: 9,
        projection: ASSET_PROJECTION,
      }).type,
    ).toBe("asset");
    expect(() =>
      derivedReferenceSchema.parse({
        mention_id: "0",
        mention_seq: 0,
        type: "asset",
        first_seen_offset: 9,
        projection: ASSET_PROJECTION,
      }),
    ).toThrow();
  });

  it("frozenGenerationParameters 要求完整可执行参数集（format/duration 可空但不缺）", () => {
    const parsed = frozenGenerationParametersSchema.parse({
      capability_type: "image",
      model_id: "doubao-seedream-5.0-lite",
      provider_id: "doubao",
      size: "1024x1024",
      aspect_ratio: "1:1",
      format: "png",
      duration: null,
      count: 1,
    });
    expect(parsed.count).toBe(1);
    // strict：少一个键（缺 duration）必须被拒，防止「应用时再猜默认值」。
    expect(() =>
      frozenGenerationParametersSchema.parse({
        capability_type: "image",
        model_id: "m",
        provider_id: "p",
        size: "1024x1024",
        aspect_ratio: "1:1",
        format: "png",
        count: 1,
      }),
    ).toThrow();
  });

  it("providerPromptAsset 的 storyboard_frame 变体用 slot_id（无 mention_id、无 projection）", () => {
    expect(
      providerPromptAssetSchema.parse({
        slot_id: "7001",
        type: "storyboard_frame",
        role: "first_frame",
      }).role,
    ).toBe("first_frame");
    // 画格走 slot_id：带 mention_id 会被 strict 拒（它没有 PlanMessage mention 身份）。
    expect(() =>
      providerPromptAssetSchema.parse({
        mention_id: "101",
        slot_id: "7001",
        type: "storyboard_frame",
        role: "first_frame",
      }),
    ).toThrow();
    expect(() =>
      providerPromptAssetSchema.parse({
        mention_id: "101",
        type: "asset",
        role: "middle_frame",
        projection: ASSET_PROJECTION,
      }),
    ).toThrow();
  });
});
