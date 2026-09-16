import { describe, expect, it, vi } from "vitest";
import type { CanvasEdge } from "@lib/contracts";
import type { TextAttachmentSnapshot } from "@lib/contracts";

import { freezePromptPlans } from "./prompt-plan-snapshot.js";
import type { WorkerInputAsset } from "../persistence/asset-ownership-types.js";
import type { ModelCapabilityView } from "../persistence/model-capability-repo.js";

// IKG4RV：生成输入以提交请求体为准——方案正文引用的素材不再要求画布上有一条落到库的连线。
// 本文件钉住三件事：
//   1. 无连线（库 edges 为空 / 无媒体边）→ 放行，不再 400（project 499 的根因）；
//   2. 素材确实不可用（已删/无权/类型不符）或超模型上限 → 仍然 400；
//   3. 视频首帧/尾帧角色以请求体 references[].role 为准，不再从连线 refRole 反推。

const PLAN_SOURCE = { sessionId: "s1", revisionId: "r1", shotNo: 1 };
const PLAN_TEXT = "参考@1 生成";
const PLAN_ATTACHMENT: TextAttachmentSnapshot = { node_id: "plan", title: "方案", text: PLAN_TEXT };

function makeModel(overrides: Partial<ModelCapabilityView["features"]> = {}, modelId = "seedream-5.0"): ModelCapabilityView {
  return {
    model_id: modelId,
    provider_id: "provider-1",
    model_label: "测试模型",
    icon: null,
    supported_sizes: [],
    supported_aspect_ratios: [],
    supported_formats: [],
    supported_durations: null,
    default_size: "1024x1024",
    default_format: null,
    default_aspect_ratio: "1:1",
    default_duration: null,
    channel_parser: "seedream",
    request_mapping: null,
    is_default: false,
    version: 1,
    digest: "digest",
    features: {
      reference_image: true,
      max_reference_images: 4,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      audio: false,
      i2i_model_name: null,
      max_prompt_length: null,
      video_reference: true,
      video_reference_max: 3,
      audio_reference: false,
      audio_reference_max: 0,
      image_reference_max: 4,
      max_reference_duration_sec: null,
      task_types: null,
      ...overrides,
    },
  };
}

function makeAsset(id: string, type = "image"): WorkerInputAsset {
  return {
    id,
    type,
    url: `https://cdn.test/${id}.png`,
    mime: "image/png",
    size: 1024,
    width: 1024,
    height: 1024,
    duration: null,
    material_id: null,
  };
}

/** 目标 + 一个引用 assetId=11 的方案文本节点；edges 由用例决定（默认空 = 连线没落库）。 */
function makeCanvas(mediaType: "image" | "video", edges: CanvasEdge[] = [], connected = false) {
  return {
    nodes: [
      { id: "target", type: "mediaNode", data: { mediaType } },
      // 连线齐全时的媒体来源卡：归属/能力边界用例用它把「连线」这一维排除掉
      ...(connected ? [{ id: "m1", type: "mediaNode", data: { mediaType: "image", assetId: "11" } }] : []),
      {
        id: "plan",
        type: "textNode",
        data: {
          title: "方案",
          text: PLAN_TEXT,
          promptSource: PLAN_SOURCE,
          promptMentions: [{ start: 2, end: 4, index: 1, assetId: "11" }],
          promptMaterials: [{ assetId: "11", mediaType: "image" }],
        },
      },
    ],
    edges,
  };
}

/** 连线齐全（含已确认的 promptReference）的边集。 */
const CONNECTED_EDGES: CanvasEdge[] = [
  { id: "e-plan", source: "plan", target: "target", data: { promptReference: { bindings: [{ index: 1, assetId: "11" }] } } },
  { id: "e-media", source: "m1", target: "target" },
];

function callFreeze(overrides: {
  mediaType?: "image" | "video";
  edges?: CanvasEdge[];
  connected?: boolean;
  inputIds?: string[];
  resolved?: WorkerInputAsset[];
  model?: ModelCapabilityView;
  references?: Array<{ asset_id?: string; material_id?: string; type: "image" | "video" | "audio"; role: "reference" | "first_frame" | "last_frame" }>;
} = {}) {
  const mediaType = overrides.mediaType ?? "image";
  const connected = overrides.connected ?? false;
  return freezePromptPlans({
    ...makeCanvas(mediaType, overrides.edges ?? (connected ? CONNECTED_EDGES : []), connected),
    version: 3,
    targetId: "target",
    type: mediaType,
    ...(overrides.references ? { references: overrides.references } : {}),
    inputIds: overrides.inputIds ?? ["11"],
    prompt: "海边日落",
    attachments: [PLAN_ATTACHMENT],
    model: overrides.model ?? makeModel(),
    userId: "u1",
    projectId: "p1",
    assets: { resolveInputAssets: vi.fn().mockResolvedValue(overrides.resolved ?? [makeAsset("11")]) },
  });
}

describe("freezePromptPlans 生成输入以请求体为准：不再要求画布连线（IKG4RV）", () => {
  it("方案引用素材存在且归属正确、画布无任何连线 → 放行", async () => {
    const snapshot = await callFreeze({ edges: [] });

    expect(snapshot).toBeDefined();
    expect(snapshot!.plans).toEqual([{ nodeId: "plan", text: PLAN_TEXT, mentions: [{ start: 2, end: 4, index: 1, assetId: "11" }] }]);
    expect(snapshot!.images).toEqual([{ assetId: "11", url: "https://cdn.test/11.png" }]);
    // 正文 @1 被替换成参考图编号标签，进入组合后的供应商正文
    expect(snapshot!.providerPrompt).toContain("参考图1");
  });

  it("画布只剩方案→目标的边、媒体边缺失（project 499 形态）→ 放行", async () => {
    const snapshot = await callFreeze({
      edges: [
        { id: "e-plan", source: "plan", target: "target" },
        { id: "e-other", source: "target", target: "target" },
      ],
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.images).toEqual([{ assetId: "11", url: "https://cdn.test/11.png" }]);
  });

  it("请求体重复同一素材 → 入口去重，快照只留一份", async () => {
    const snapshot = await callFreeze({ inputIds: ["11", "11"] });

    expect(snapshot!.images).toEqual([{ assetId: "11", url: "https://cdn.test/11.png" }]);
  });
});

describe("freezePromptPlans 保留的边界校验（IKG4RV 不放松）", () => {
  // connected: true 的用例把「连线」这一维排除掉——它们在改动前后都必须 400，
  // 用于证明删除连线校验没有顺带放松归属/能力/索引边界。
  it("方案声明的素材不在本次请求体里 → 仍 400（只删连线那一半，请求体这一半保留）", async () => {
    await expect(callFreeze({ inputIds: ["22"] }))
      .rejects.toThrow("提示词引用的素材缺失或不完整，请补充素材或移除对应引用后再生成");
  });

  it("引用素材已删除/无权访问（归属解析为空）→ 仍 400", async () => {
    await expect(callFreeze({ connected: true, resolved: [] })).rejects.toThrow("素材已删除、无权访问或类型不受支持");
  });

  it("引用素材类型不符（声明图片实为视频）→ 仍 400", async () => {
    await expect(callFreeze({ connected: true, resolved: [makeAsset("11", "video")] }))
      .rejects.toThrow("素材已删除、无权访问或类型不受支持");
  });

  it("参考图数量超过模型上限 → 仍 400", async () => {
    await expect(callFreeze({ connected: true, model: makeModel({ max_reference_images: 0 }) })).rejects.toThrow("参考图最多 0 张");
  });

  it("模型不支持图片参考 → 仍 400", async () => {
    await expect(callFreeze({ connected: true, model: makeModel({ reference_image: false }) })).rejects.toThrow("当前模型不支持图片参考");
  });

  it("正文 @ 索引无效 → 仍 400", async () => {
    const plan = {
      ...makeCanvas("image"),
      nodes: [
        { id: "target", type: "mediaNode", data: { mediaType: "image" } },
        {
          id: "plan",
          type: "textNode",
          data: {
            title: "方案",
            text: PLAN_TEXT,
            promptSource: PLAN_SOURCE,
            // end 超出正文长度 → validPromptMentions 不通过
            promptMentions: [{ start: 2, end: 99, index: 1, assetId: "11" }],
            promptMaterials: [{ assetId: "11", mediaType: "image" }],
          },
        },
      ],
      edges: [],
    };
    await expect(freezePromptPlans({
      ...plan,
      version: 3,
      targetId: "target",
      type: "image",
      inputIds: ["11"],
      prompt: "海边日落",
      attachments: [PLAN_ATTACHMENT],
      model: makeModel(),
      userId: "u1",
      projectId: "p1",
      assets: { resolveInputAssets: vi.fn().mockResolvedValue([makeAsset("11")]) },
    })).rejects.toThrow("正文素材索引无效");
  });

  it("视频首帧角色以请求体 role 为准，画布无 refRole 连线 → 放行且角色保持", async () => {
    const snapshot = await callFreeze({
      mediaType: "video",
      edges: [],
      model: makeModel({}, "seedance-2"),
      references: [{ asset_id: "11", type: "image", role: "first_frame" }],
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.videoReferences).toEqual([{
      assetId: "11",
      type: "image",
      role: "first_frame",
      url: "https://cdn.test/11.png",
      providerUrl: "https://cdn.test/11.png",
    }]);
    expect(snapshot!.providerPrompt).toContain("首帧");
  });
});
