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

const sceneCardAsset = {
  mention_id: "201",
  type: "scene_card" as const,
  role: "reference" as const,
  projection: {
    title: "场景卡",
    summary: null,
    content_markdown: "# 正文",
    version: 1,
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

  it("拒绝只选尾帧不选首帧（尾帧必须与首帧一起使用）", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "last_frame",
        reference_assets: [{ ...referenceAsset, role: "last_frame" }],
      }),
    ).toThrow(/尾帧必须与首帧一起使用/);
  });

  it("接受首帧+尾帧组合", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "first_and_last_frame",
        reference_assets: [
          { ...referenceAsset, role: "first_frame" },
          { ...referenceAsset, mention_id: "102", role: "last_frame" },
        ],
      }),
    ).not.toThrow();
  });

  it("拒绝首尾帧与普通参考素材混用", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "first_frame",
        reference_assets: [
          { ...referenceAsset, role: "first_frame" },
          { ...referenceAsset, mention_id: "102", role: "reference" },
        ],
      }),
    ).toThrow(/首尾帧模式不能与普通参考素材混用/);
  });

  // IKHBDO：原先这里断言「参考素材最多 12 个」。契约层拿不到能力行，数量上限不能写死在这里——
  // 判定下移到手握能力行的 scene-card-generation-repo（checkReferenceCountLimits）。
  // 本用例保留原「超量参考」的输入形状，断言改为**契约层不再拦**（上限由能力行决定，
  // 例如配了 30 的模型必须能提交 13 个）。
  it("不再在契约层拦参考数量（上限由能力行在 repo 层判定）", () => {
    const references = Array.from({ length: 13 }, (_, index) => ({
      ...referenceAsset,
      mention_id: String(101 + index),
    }));
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_assets: references,
      }),
    ).not.toThrow();
  });

  it("拒绝场景卡素材作为首帧（scene_card 无 asset 映射，不静默降级）", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "first_frame",
        reference_assets: [{ ...sceneCardAsset, role: "first_frame" }],
      }),
    ).toThrow(/场景卡素材不能作为首帧\/尾帧/);
  });

  it("拒绝场景卡素材作为尾帧", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_mode: "first_and_last_frame",
        reference_assets: [
          { ...referenceAsset, role: "first_frame" },
          { ...sceneCardAsset, role: "last_frame" },
        ],
      }),
    ).toThrow(/场景卡素材不能作为首帧\/尾帧/);
  });

  it("接受场景卡素材作为普通参考", () => {
    expect(() =>
      sceneCardRegenerationRequestSchema.parse({
        ...baseRequest,
        reference_assets: [sceneCardAsset],
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
      }),
    ).toThrow();
  });

  // 计划通道退役后 plan_message_id 不再是投影字段，多余键被 strict() 拒绝。
  it("拒绝多余的 plan_message_id（已随计划通道退役）", () => {
    expect(() =>
      sceneCardGenerationRecordViewSchema.parse({
        record_id: "8001",
        scene_card_id: "5001",
        summary_status: "success",
        first_generation_job_id: "9001",
        plan_message_id: "1001",
      }),
    ).toThrow();
  });
});
