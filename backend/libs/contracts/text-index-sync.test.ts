import { describe, expect, it } from "vitest";
import {
  AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  TEXT_INDEX_INVALID_MESSAGE,
  TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
  VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE,
  checkAudioTextIndexSyncInput,
  checkTextIndexSyncInput,
  checkVideoTextIndexSyncInput,
  mergeTextProvidedReferences,
  textIndexOfTarget,
  textInputSignatureOf,
  textProvidedAudioReferences,
  textProvidedVideoReferences,
  type TargetTextInputEntry,
  type TextIndexCanvasNode,
  type TextProvidedRef,
} from "./text-index-sync.js";
import type { MediaMention, MediaRef } from "./text-node-media.js";

const mention = (start: number, end: number, nodeId: string, assetId: string): MediaMention => ({ start, end, nodeId, assetId });
const ref = (nodeId: string, assetId: string, mediaType: MediaRef["mediaType"], name = "素材名", url = "https://example.com/m.png"): MediaRef => ({ nodeId, assetId, mediaType, name, url });

function textNode(id: string, data: Record<string, unknown>): TextIndexCanvasNode {
  return { id, type: "textNode", data };
}

function mediaNode(id: string, data: Record<string, unknown> = { assetId: `9${id.slice(-1)}00`, src: "https://example.com/a.png" }): TextIndexCanvasNode {
  return { id, type: "mediaNode", data };
}

describe("textIndexOfTarget", () => {
  it("有效身份进 refs/inputs，按文本边序与正文首现序", () => {
    const nodes = [
      textNode("text-1", {
        text: "用 图片1 和 视频1",
        mediaMentions: [mention(2, 5, "media-1", "9100"), mention(6, 9, "media-2", "9200")],
        mediaRefs: [ref("media-1", "9100", "image", "甲图"), ref("media-2", "9200", "video", "乙视频")],
      }),
      textNode("text-2", {
        text: "再来 图片1",
        mediaMentions: [mention(3, 6, "media-3", "9300")],
        mediaRefs: [ref("media-3", "9300", "image", "丙图")],
      }),
      mediaNode("media-1"),
      mediaNode("media-2"),
      mediaNode("media-3"),
    ];
    const edges = [
      { source: "text-2", target: "gen-1" },
      { source: "text-1", target: "gen-1" },
      { source: "media-3", target: "text-2", data: { textIndex: true } },
      { source: "media-1", target: "text-1", data: { textIndex: true } },
      { source: "media-2", target: "text-1", data: { textIndex: true } },
    ];
    const index = textIndexOfTarget(nodes, edges, "gen-1");
    expect(index.inputs.map((entry) => entry.nodeId)).toEqual(["text-2", "text-1"]);
    expect(index.refs.map((item) => item.assetId)).toEqual(["9300", "9100", "9200"]);
    expect(index.refs[1]).toMatchObject({ textNodeId: "text-1", sourceNodeId: "media-1", name: "甲图" });
    expect(index.inputs[1].identities).toEqual([
      { sourceNodeId: "media-1", assetId: "9100", mediaType: "image" },
      { sourceNodeId: "media-2", assetId: "9200", mediaType: "video" },
    ]);
    expect(index.invalid).toEqual([]);
  });

  it("同身份重复标签只取首现一次；无 textIndex 线/来源节点缺失/assetMissing/ref 缺失均判失效", () => {
    const nodes = [
      textNode("text-1", {
        text: "四个标签",
        mediaMentions: [
          mention(0, 1, "media-1", "9100"),
          mention(1, 2, "media-1", "9100"),
          mention(2, 3, "media-2", "9200"),
          mention(3, 4, "media-4", "9400"),
        ],
        mediaRefs: [ref("media-1", "9100", "image"), ref("media-2", "9200", "image"), ref("media-4", "9400", "image", "丁图")],
      }),
      { id: "media-2", type: "mediaNode", data: { assetId: "9200", assetMissing: true, src: "x" } satisfies Record<string, unknown> },
      mediaNode("media-4"),
    ];
    const edges = [
      { source: "text-1", target: "gen-1" },
      { source: "media-1", target: "text-1", data: { textIndex: true } },
      { source: "media-4", target: "text-1" },
    ];
    const index = textIndexOfTarget(nodes, edges, "gen-1");
    expect(index.refs).toEqual([]);
    expect(index.inputs[0]!.identities).toEqual([]);
    expect(index.invalid).toEqual([
      { textNodeId: "text-1", sourceNodeId: "media-1", name: "素材名" },
      { textNodeId: "text-1", sourceNodeId: "media-2", name: "素材名" },
      { textNodeId: "text-1", sourceNodeId: "media-4", name: "丁图" },
    ]);
  });

  it("非文本来源边与非法形状不参与；mediaMentions/mediaRefs 缺失视为无索引", () => {
    const index = textIndexOfTarget(
      [textNode("text-1", { text: "纯文本" }), mediaNode("media-1")],
      [
        { source: "media-1", target: "gen-1" },
        { source: "text-1", target: "gen-1" },
        "junk",
      ],
      "gen-1",
    );
    expect(index.inputs).toEqual([{ nodeId: "text-1", text: "纯文本", identities: [] }]);
    expect(index.refs).toEqual([]);
    expect(index.invalid).toEqual([]);
  });
});

describe("mergeTextProvidedReferences", () => {
  const provided = (assetId: string): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: `media-${assetId}`,
    assetId,
    mediaType: "image",
    name: assetId,
    url: "u",
  });

  it("直接参考在前、文本带入追加、同 assetId 去重保首见", () => {
    const { merged, addedAssetIds } = mergeTextProvidedReferences(
      [9100, "9200"],
      [provided("9200"), provided("9300"), provided("9300")],
    );
    expect(merged).toEqual([9100, "9200", "9300"]);
    expect(addedAssetIds).toEqual(["9300"]);
  });

  it("无直接参考时全量追加", () => {
    const { merged, addedAssetIds } = mergeTextProvidedReferences([], [provided("9100"), provided("9101")]);
    expect(merged).toEqual(["9100", "9101"]);
    expect(addedAssetIds).toEqual(["9100", "9101"]);
  });
});

describe("checkTextIndexSyncInput", () => {
  const imageRef = (mediaType: TextProvidedRef["mediaType"]): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: "media-1",
    assetId: "9100",
    mediaType,
    name: "n",
    url: "u",
  });

  it("失效索引优先阻止", () => {
    expect(
      checkTextIndexSyncInput({
        index: { refs: [imageRef("video")], invalid: [{ textNodeId: "t", sourceNodeId: "m", name: "n" }] },
        acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
        mergedReferenceCount: 99,
        maxReferences: 10,
      }),
    ).toEqual({ kind: "invalid_index" });
  });

  it("不支持的媒体类型阻止并列出类型", () => {
    expect(
      checkTextIndexSyncInput({
        index: { refs: [imageRef("video"), imageRef("audio"), imageRef("video")], invalid: [] },
        acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
        mergedReferenceCount: 3,
        maxReferences: 10,
      }),
    ).toEqual({ kind: "unsupported_media_type", mediaTypes: ["video", "audio"] });
  });

  it("合并后超限阻止；合法输入放行", () => {
    const overflow = checkTextIndexSyncInput({
      index: { refs: [imageRef("image")], invalid: [] },
      acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
      mergedReferenceCount: 11,
      maxReferences: 10,
    });
    expect(overflow).toEqual({ kind: "reference_overflow", max: 10 });
    expect(
      checkTextIndexSyncInput({
        index: { refs: [imageRef("image")], invalid: [] },
        acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
        mergedReferenceCount: 10,
        maxReferences: 10,
      }),
    ).toBeNull();
  });

  it("提供用户可读文案常量", () => {
    expect(TEXT_INDEX_INVALID_MESSAGE).toContain("失效");
    expect(TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE).toContain("不支持");
  });
});

describe("textInputSignatureOf", () => {
  const entry = (nodeId: string, text: string, identities: TargetTextInputEntry["identities"]): TargetTextInputEntry => ({
    nodeId,
    text,
    identities,
  });
  const ids = [{ sourceNodeId: "media-1", assetId: "9100", mediaType: "image" as const }];

  it("同输入恒等、确定性（非随机）", () => {
    const a = textInputSignatureOf([entry("t1", "正文", ids)]);
    expect(textInputSignatureOf([entry("t1", "正文", ids)])).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("正文或身份集合变化改变签名；身份顺序变化也改变", () => {
    const base = textInputSignatureOf([entry("t1", "正文", ids)]);
    expect(textInputSignatureOf([entry("t1", "正文改", ids)])).not.toBe(base);
    expect(textInputSignatureOf([entry("t1", "正文", [])])).not.toBe(base);
    const two = [
      { sourceNodeId: "m1", assetId: "1", mediaType: "image" as const },
      { sourceNodeId: "m2", assetId: "2", mediaType: "image" as const },
    ];
    expect(textInputSignatureOf([entry("t1", "x", two)])).not.toBe(
      textInputSignatureOf([entry("t1", "x", [two[1]!, two[0]!])]),
    );
  });

  it("文本卡边序参与签名；无文本输入为稳定常量签名", () => {
    const ab = textInputSignatureOf([entry("t1", "a", []), entry("t2", "b", [])]);
    const ba = textInputSignatureOf([entry("t2", "b", []), entry("t1", "a", [])]);
    expect(ab).not.toBe(ba);
    expect(textInputSignatureOf([])).toBe(textInputSignatureOf([]));
  });
});

describe("textProvidedVideoReferences（契约 §10 视频并入）", () => {
  const provided = (assetId: string, mediaType: TextProvidedRef["mediaType"] = "image"): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: `media-${assetId}`,
    assetId,
    mediaType,
    name: assetId,
    url: "u",
  });

  it("直接参考已含的 assetId 去重；追加项恒为普通参考并保留类型", () => {
    const added = textProvidedVideoReferences(
      [
        { role: "first_frame", asset_id: "9100", type: "image" },
        { role: "reference", asset_id: "9200", type: "image" },
      ],
      [provided("9100"), provided("9200"), provided("9300", "video"), provided("9300", "video")],
    );
    expect(added).toEqual([{ role: "reference", asset_id: "9300", type: "video" }]);
  });

  it("material_id 直接参考不参与 assetId 去重；无直接参考时全量追加", () => {
    const added = textProvidedVideoReferences(
      [{ role: "reference", material_id: "asset-2026", type: "image" }],
      [provided("9100"), provided("9200", "audio")],
    );
    expect(added).toEqual([
      { role: "reference", asset_id: "9100", type: "image" },
      { role: "reference", asset_id: "9200", type: "audio" },
    ]);
    expect(textProvidedVideoReferences([], [])).toEqual([]);
  });
});

describe("checkVideoTextIndexSyncInput（契约 §10 视频校验）", () => {
  const ref = (mediaType: TextProvidedRef["mediaType"]): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: "media-1",
    assetId: "9100",
    mediaType,
    name: "n",
    url: "u",
  });

  it("失效索引最优先阻止", () => {
    expect(
      checkVideoTextIndexSyncInput({
        index: { refs: [ref("image")], invalid: [{ textNodeId: "t", sourceNodeId: "m", name: "n" }] },
        acceptedMediaTypes: ["image"],
        hasFrameRole: true,
      }),
    ).toEqual({ kind: "invalid_index" });
  });

  it("帧角色存在且文本带入非空 → frame_conflict；帧存在但文本带入为空不冲突", () => {
    expect(
      checkVideoTextIndexSyncInput({
        index: { refs: [ref("image")], invalid: [] },
        acceptedMediaTypes: ["image"],
        hasFrameRole: true,
      }),
    ).toEqual({ kind: "frame_conflict" });
    expect(
      checkVideoTextIndexSyncInput({
        index: { refs: [], invalid: [] },
        acceptedMediaTypes: ["image"],
        hasFrameRole: true,
      }),
    ).toBeNull();
  });

  it("不支持的媒体类型阻止并列出类型；合法输入放行", () => {
    expect(
      checkVideoTextIndexSyncInput({
        index: { refs: [ref("video"), ref("audio")], invalid: [] },
        acceptedMediaTypes: ["image"],
        hasFrameRole: false,
      }),
    ).toEqual({ kind: "unsupported_media_type", mediaTypes: ["video", "audio"] });
    expect(
      checkVideoTextIndexSyncInput({
        index: { refs: [ref("image"), ref("video")], invalid: [] },
        acceptedMediaTypes: ["image", "video"],
        hasFrameRole: false,
      }),
    ).toBeNull();
  });

  it("提供视频互斥文案常量", () => {
    expect(VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE).toContain("首尾帧");
  });
});

describe("textProvidedAudioReferences（契约 §11 音频并入）", () => {
  const provided = (assetId: string, mediaType: TextProvidedRef["mediaType"] = "audio"): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: `media-${assetId}`,
    assetId,
    mediaType,
    name: assetId,
    url: "u",
  });

  it("直接参考已含的 assetId 去重；追加项恒为普通参考并保留类型（audio|image）", () => {
    const added = textProvidedAudioReferences(
      [
        { role: "reference", asset_id: "9100", type: "audio" },
        { role: "reference", asset_id: "9200", type: "image" },
      ],
      [provided("9100"), provided("9200"), provided("9300", "image"), provided("9300", "image")],
    );
    expect(added).toEqual([{ role: "reference", asset_id: "9300", type: "image" }]);
  });

  it("无直接参考时全量追加；空输入返回空", () => {
    expect(textProvidedAudioReferences([], [provided("9100"), provided("9200", "image")])).toEqual([
      { role: "reference", asset_id: "9100", type: "audio" },
      { role: "reference", asset_id: "9200", type: "image" },
    ]);
    expect(textProvidedAudioReferences([], [])).toEqual([]);
  });
});

describe("checkAudioTextIndexSyncInput（契约 §11 音频校验）", () => {
  const ref = (mediaType: TextProvidedRef["mediaType"]): TextProvidedRef => ({
    textNodeId: "text-1",
    sourceNodeId: "media-1",
    assetId: "9100",
    mediaType,
    name: "n",
    url: "u",
  });

  it("失效索引最优先阻止", () => {
    expect(
      checkAudioTextIndexSyncInput({
        index: { refs: [ref("audio")], invalid: [{ textNodeId: "t", sourceNodeId: "m", name: "n" }] },
        acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
      }),
    ).toEqual({ kind: "invalid_index" });
  });

  it("video 类型阻止；audio/image 放行（容量与混用由既有 checkReferenceLimits 接管）", () => {
    expect(
      checkAudioTextIndexSyncInput({
        index: { refs: [ref("video"), ref("audio")], invalid: [] },
        acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
      }),
    ).toEqual({ kind: "unsupported_media_type", mediaTypes: ["video"] });
    expect(
      checkAudioTextIndexSyncInput({
        index: { refs: [ref("audio"), ref("image")], invalid: [] },
        acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
      }),
    ).toBeNull();
    expect(AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES).toEqual(["audio", "image"]);
  });
});
