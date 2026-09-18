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
function makeCanvas(
  mediaType: "image" | "video",
  edges: CanvasEdge[] = [],
  connected = false,
  targetData: Record<string, unknown> = {},
  extraNodes: Array<{ id: string; type: string; data: Record<string, unknown> }> = [],
) {
  return {
    nodes: [
      { id: "target", type: "mediaNode", data: { mediaType, ...targetData } },
      // 连线齐全时的媒体来源卡：归属/能力边界用例用它把「连线」这一维排除掉
      ...(connected ? [{ id: "m1", type: "mediaNode", data: { mediaType: "image", assetId: "11" } }] : []),
      ...extraNodes,
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
  /** 按入参 id 造归属结果（默认对每个 id 返回同 id 的图片 asset，material_id 为 null）。 */
  resolveImpl?: (ids: string[]) => WorkerInputAsset[];
  model?: ModelCapabilityView;
  draftMaterialRefs?: Array<{ materialId: string; mediaType: string; role: string; url: string }>;
  extraNodes?: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  references?: Array<{ asset_id?: string; material_id?: string; type: "image" | "video" | "audio"; role: "reference" | "first_frame" | "last_frame" }>;
} = {}) {
  const mediaType = overrides.mediaType ?? "image";
  const connected = overrides.connected ?? false;
  const targetData = overrides.draftMaterialRefs ? { draftMaterialRefs: overrides.draftMaterialRefs } : {};
  return freezePromptPlans({
    ...makeCanvas(mediaType, overrides.edges ?? (connected ? CONNECTED_EDGES : []), connected, targetData, overrides.extraNodes ?? []),
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
    assets: {
      resolveInputAssets: vi.fn(async (ids: string[]) =>
        overrides.resolveImpl ? overrides.resolveImpl(ids) : overrides.resolved ?? ids.map(id => makeAsset(id))),
    },
  });
}

describe("freezePromptPlans 生成输入以请求体为准：不再要求画布连线（IKG4RV）", () => {
  it("方案引用素材存在且归属正确、画布无任何连线 → 放行", async () => {
    const snapshot = await callFreeze({ edges: [] });

    expect(snapshot).toBeDefined();
    expect(snapshot!.plans).toEqual([{ nodeId: "plan", text: PLAN_TEXT, mentions: [{ start: 2, end: 4, index: 1, assetId: "11" }] }]);
    expect(snapshot!.images).toEqual([{ assetId: "11", url: "https://cdn.test/11.png" }]);
    // IKG6EK / ADR-0088：providerPrompt 已退役——正文由提交方给全，引用标记转移在接纳管线完成
    // （backend/libs/core/transfer-reference-markers.ts，用例见该文件）。
    // 本文件只钉住快照不再携带它。
    expect(snapshot).not.toHaveProperty("providerPrompt");
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
    // IKG6EK / ADR-0088：正文不再由快照携带（见上条注释）
    expect(snapshot).not.toHaveProperty("providerPrompt");
  });
});

// IKG79Z（测试环境 project 492 实证）：方案绑定以本地 assetId 表达，素材库引用在请求体里以 material_id 表达，
// 是同一媒体的两种身份。视频分支的 inputIds 只收 asset_id，material 引用贡献 0 个 —— 只按 assetId 比对
// 会把「方案卡 + 素材库素材」整条路径误判成素材缺失。
describe("freezePromptPlans 素材库素材的身份映射（IKG79Z）", () => {
  /** 目标节点上已保存的素材库参考（走 material_id 的路径要它存在）。 */
  const DRAFT_MATERIAL_REFS = [{ materialId: "mat-1", mediaType: "image", role: "reference", url: "https://cdn.test/mat-1.png" }];
  const MATERIAL_REFS = [{ material_id: "mat-1", type: "image" as const, role: "reference" as const }];

  it("方案绑定是本地 assetId、请求只带同一素材的 material_id → 放行，且标签不是 参考图0", async () => {
    const snapshot = await callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      inputIds: [], // video + 素材库引用：请求里没有 asset_id
      references: MATERIAL_REFS,
      draftMaterialRefs: DRAFT_MATERIAL_REFS,
      resolveImpl: (ids) => ids.map(id => ({ ...makeAsset(id), material_id: "mat-1" })),
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.videoReferences).toEqual([{
      materialId: "mat-1",
      type: "image",
      role: "reference",
      url: "https://cdn.test/mat-1.png",
      providerUrl: "asset://mat-1",
    }]);
    // IKG6EK / ADR-0088：正文不再由快照携带；标签派生（含 material 身份回查）改由
    // transfer-reference-markers.ts 承担——身份不在集合里就不转、原样保留。
    expect(snapshot).not.toHaveProperty("providerPrompt");
  });

  it("该 asset 关联的 material 与请求里的不是同一个 → 仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      inputIds: [],
      references: MATERIAL_REFS,
      draftMaterialRefs: DRAFT_MATERIAL_REFS,
      resolveImpl: (ids) => ids.map(id => ({ ...makeAsset(id), material_id: "mat-other" })),
    })).rejects.toThrow("提示词引用的素材缺失或不完整");
  });

  it("asset 没有关联 material_id、也不在请求体里 → 仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      inputIds: [],
      references: MATERIAL_REFS,
      draftMaterialRefs: DRAFT_MATERIAL_REFS,
      // 默认 makeAsset 的 material_id 为 null
      resolveImpl: (ids) => ids.map(id => makeAsset(id)),
    })).rejects.toThrow("提示词引用的素材缺失或不完整");
  });

  it("归属查询查不到该 asset（越权/已删）→ 不建立映射，仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      inputIds: [],
      references: MATERIAL_REFS,
      draftMaterialRefs: DRAFT_MATERIAL_REFS,
      resolveImpl: () => [],
    })).rejects.toThrow("提示词引用的素材缺失或不完整");
  });

  it("image 目标不走身份放宽 → 仍 400，不放行成「参考图0 + 零参考」", async () => {
    // image 的 inputIds 来自旧字段，references[].material_id 既不构成输入也没有 videoReferences 可回查；
    // 放宽若不分类型，这里会放行并产出 `参考图0` 且 images 为空——正是保留那条校验要防的静默降级。
    await expect(callFreeze({
      mediaType: "image",
      inputIds: [],
      references: MATERIAL_REFS,
      resolveImpl: (ids) => ids.map(id => ({ ...makeAsset(id), material_id: "mat-1" })),
    })).rejects.toThrow("提示词引用的素材缺失或不完整");
  });
});

// IKG79Z：素材库素材有两种落点——纯素材库引用存 `draftMaterialRefs`；有本地 asset 行的会落成画布节点
// （节点同时带 assetId 与 materialId）。视频分支只认前者时，后者恒 400（测试环境 project 492 实证）。
describe("freezePromptPlans 素材库素材落成画布节点（IKG79Z）", () => {
  const MATERIAL_REFS = [{ material_id: "mat-1", type: "image" as const, role: "reference" as const }];
  const MATERIAL_NODE = {
    id: "m-mat",
    type: "mediaNode",
    data: { mediaType: "image", materialId: "mat-1", assetId: "42", src: "https://cdn.test/mat-1.png" },
  };

  it("目标无 draftMaterialRefs、素材在画布上以节点形式存在 → 放行", async () => {
    const snapshot = await callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      references: MATERIAL_REFS,
      extraNodes: [MATERIAL_NODE],
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.videoReferences).toEqual([{
      materialId: "mat-1",
      type: "image",
      role: "reference",
      url: "https://cdn.test/mat-1.png",
      providerUrl: "asset://mat-1",
    }]);
  });

  it("既不在 draftMaterialRefs、画布上也没有对应节点 → 仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      references: MATERIAL_REFS,
      extraNodes: [],
    })).rejects.toThrow("素材库参考与目标已保存输入不一致");
  });

  it("画布节点存在但媒体类型与请求不符 → 仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      references: MATERIAL_REFS,
      extraNodes: [{ ...MATERIAL_NODE, data: { ...MATERIAL_NODE.data, mediaType: "video" } }],
    })).rejects.toThrow("素材库参考与目标已保存输入不一致");
  });

  it("生产形态：inputIds 为空 + 方案绑定走身份映射 + 素材落成画布节点 → 放行（project 492 全链路）", async () => {
    const snapshot = await callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      inputIds: [], // video + 素材库引用：请求里没有 asset_id
      references: MATERIAL_REFS,
      extraNodes: [MATERIAL_NODE],
      // 方案绑定 assetId=11 关联到请求里的 material mat-1 → 走身份映射放行
      resolveImpl: (ids) => ids.map(id => ({ ...makeAsset(id), material_id: "mat-1" })),
    });

    expect(snapshot).toBeDefined();
    expect(snapshot!.videoReferences).toEqual([{
      materialId: "mat-1",
      type: "image",
      role: "reference",
      url: "https://cdn.test/mat-1.png",
      providerUrl: "asset://mat-1",
    }]);
    // IKG6EK / ADR-0088：正文不再由快照携带（见上条注释）
    expect(snapshot).not.toHaveProperty("providerPrompt");
  });

  it("同 materialId 另有类型不符的节点时取类型相符的那个，不按首个命中误拒", async () => {
    const snapshot = await callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      references: MATERIAL_REFS,
      extraNodes: [
        { id: "m-wrong", type: "mediaNode", data: { mediaType: "video", materialId: "mat-1", src: "https://cdn.test/wrong.mp4" } },
        MATERIAL_NODE,
      ],
    });

    expect(snapshot!.videoReferences).toEqual([{
      materialId: "mat-1",
      type: "image",
      role: "reference",
      url: "https://cdn.test/mat-1.png",
      providerUrl: "asset://mat-1",
    }]);
  });

  it("命中的节点已被判失效（assetMissing）→ 仍 400", async () => {
    await expect(callFreeze({
      mediaType: "video",
      model: makeModel({}, "seedance-2"),
      references: MATERIAL_REFS,
      extraNodes: [{ ...MATERIAL_NODE, data: { ...MATERIAL_NODE.data, assetMissing: true } }],
    })).rejects.toThrow("素材库参考与目标已保存输入不一致");
  });
});
