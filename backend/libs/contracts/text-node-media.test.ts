import { describe, expect, it } from "vitest";
import {
  deriveMediaMentionLabels,
  deriveMediaMentionLabelsInOrder,
  invalidMediaMentionLabel,
  mediaAndPromptMentionsDisjoint,
  mediaMentionSchema,
  mediaRefSchema,
  mediaRefsCoverMentions,
  validMediaMentions,
  type MediaMention,
  type MediaRef,
} from "./text-node-media.js";

const mention = (start: number, end: number, nodeId: string, assetId: string): MediaMention => ({ start, end, nodeId, assetId });
const ref = (nodeId: string, assetId: string, mediaType: MediaRef["mediaType"], name = "素材名", url = "https://example.com/m.png"): MediaRef => ({ nodeId, assetId, mediaType, name, url });

describe("mediaMentionSchema / mediaRefSchema", () => {
  it("接受合法形状并拒绝多余键（strict）", () => {
    expect(mediaMentionSchema.safeParse(mention(0, 3, "media-1", "9001")).success).toBe(true);
    expect(mediaMentionSchema.safeParse({ ...mention(0, 3, "media-1", "9001"), index: 1 }).success).toBe(false);
    expect(mediaRefSchema.safeParse(ref("media-1", "9001", "image")).success).toBe(true);
    expect(mediaRefSchema.safeParse({ ...ref("media-1", "9001", "image"), role: "reference" }).success).toBe(false);
  });

  it("assetId 只收正整数数字字符串", () => {
    expect(mediaMentionSchema.safeParse(mention(0, 1, "n", "0")).success).toBe(false);
    expect(mediaMentionSchema.safeParse(mention(0, 1, "n", "01")).success).toBe(false);
    expect(mediaMentionSchema.safeParse(mention(0, 1, "n", "abc")).success).toBe(false);
    expect(mediaRefSchema.safeParse(ref("n", "12a", "image")).success).toBe(false);
  });

  it("nodeId/name 限长空串拒绝，mediaType 枚举外拒绝", () => {
    expect(mediaMentionSchema.safeParse(mention(0, 1, "", "9")).success).toBe(false);
    expect(mediaMentionSchema.safeParse(mention(0, 1, "x".repeat(129), "9")).success).toBe(false);
    expect(mediaRefSchema.safeParse(ref("n", "9", "image", "")).success).toBe(false);
    expect(mediaRefSchema.safeParse(ref("n", "9", "image", "x".repeat(201))).success).toBe(false);
    expect(mediaRefSchema.safeParse({ ...ref("n", "9", "image"), mediaType: "text" }).success).toBe(false);
  });
});

describe("validMediaMentions", () => {
  const text = "开头图片1中间视频1结尾";

  it("空区间与单个区间合法", () => {
    expect(validMediaMentions(text, [])).toBe(true);
    expect(validMediaMentions(text, [mention(2, 5, "media-a", "9001")])).toBe(true);
  });

  it("重叠、越界、倒置区间均拒绝", () => {
    expect(validMediaMentions(text, [mention(2, 6, "a", "9001"), mention(5, 8, "b", "9002")])).toBe(false);
    expect(validMediaMentions(text, [mention(2, text.length + 1, "a", "9001")])).toBe(false);
    expect(validMediaMentions(text, [mention(3, 3, "a", "9001")])).toBe(false);
  });

  it("同 nodeId 重复引用同 assetId 合法（顺序无关），异 assetId 拒绝", () => {
    const repeats = [mention(6, 9, "media-a", "9001"), mention(2, 5, "media-a", "9001")];
    expect(validMediaMentions(text, repeats)).toBe(true);
    expect(validMediaMentions(text, [mention(2, 5, "media-a", "9001"), mention(6, 9, "media-a", "9002")])).toBe(false);
  });
});

describe("mediaRefsCoverMentions", () => {
  const mentions = [mention(2, 5, "media-a", "9001"), mention(6, 9, "media-b", "9002"), mention(10, 13, "media-a", "9001")];

  it("精确覆盖合法（重复身份共享一条 ref）", () => {
    expect(mediaRefsCoverMentions(mentions, [ref("media-a", "9001", "image"), ref("media-b", "9002", "video")])).toBe(true);
    expect(mediaRefsCoverMentions([], [])).toBe(true);
  });

  it("缺 ref、多 ref、重复 ref、assetId 不一致均拒绝", () => {
    expect(mediaRefsCoverMentions(mentions, [ref("media-a", "9001", "image")])).toBe(false);
    expect(mediaRefsCoverMentions(mentions, [ref("media-a", "9001", "image"), ref("media-b", "9002", "video"), ref("media-c", "9003", "audio")])).toBe(false);
    expect(mediaRefsCoverMentions(mentions, [ref("media-a", "9001", "image"), ref("media-a", "9001", "image"), ref("media-b", "9002", "video")])).toBe(false);
    expect(mediaRefsCoverMentions(mentions, [ref("media-a", "9002", "image"), ref("media-b", "9002", "video")])).toBe(false);
  });
});

describe("mediaAndPromptMentionsDisjoint", () => {
  const binding = (start: number, end: number, assetId: string) => ({ start, end, assetId });

  it("同区间且同 assetId 放行（applyPreview 派生的方案绑定镜像，IKG6EK）", () => {
    const media = [mention(10, 13, "media-1", "9001"), mention(165, 168, "media-1", "9001")];
    const bindings = [binding(10, 13, "9001"), binding(165, 168, "9001")];
    expect(mediaAndPromptMentionsDisjoint(media, bindings)).toBe(true);
    expect(mediaAndPromptMentionsDisjoint(bindings, media)).toBe(true);
  });

  it("仅 media、仅方案绑定、两者不重叠均放行", () => {
    expect(mediaAndPromptMentionsDisjoint([mention(10, 13, "media-1", "9001")], [])).toBe(true);
    expect(mediaAndPromptMentionsDisjoint([], [binding(10, 13, "9001")])).toBe(true);
    expect(mediaAndPromptMentionsDisjoint([mention(10, 13, "media-1", "9001")], [binding(13, 16, "9002")])).toBe(true);
  });

  it("部分重叠拒绝（IKFM3Q 原契约不变）", () => {
    expect(mediaAndPromptMentionsDisjoint([mention(10, 13, "media-1", "9001")], [binding(11, 14, "9001")])).toBe(false);
    expect(mediaAndPromptMentionsDisjoint([mention(10, 20, "media-1", "9001")], [binding(12, 14, "9001")])).toBe(false);
    expect(mediaAndPromptMentionsDisjoint([mention(12, 14, "media-1", "9001")], [binding(10, 20, "9001")])).toBe(false);
  });

  it("同区间但指向不同 assetId 拒绝（脏数据）", () => {
    expect(mediaAndPromptMentionsDisjoint([mention(10, 13, "media-1", "9001")], [binding(10, 13, "9002")])).toBe(false);
  });
});

describe("deriveMediaMentionLabels", () => {
  const allValid = () => true;

  it("按正文首次出现顺序分类型编号，同身份复用", () => {
    const mentions = [
      mention(30, 33, "media-v1", "9003"),
      mention(0, 3, "media-i1", "9001"),
      mention(10, 13, "media-i2", "9002"),
      mention(20, 23, "media-i1", "9001"),
      mention(40, 43, "media-a1", "9004"),
    ];
    const refs = [ref("media-i1", "9001", "image"), ref("media-i2", "9002", "image"), ref("media-v1", "9003", "video"), ref("media-a1", "9004", "audio")];
    const labels = deriveMediaMentionLabels(mentions, refs, allValid);
    expect(labels.get("media-i1")).toBe("图片1");
    expect(labels.get("media-i2")).toBe("图片2");
    expect(labels.get("media-v1")).toBe("视频1");
    expect(labels.get("media-a1")).toBe("音频1");
    expect(labels.size).toBe(4);
  });

  it("失效身份不参与编号，显示已失效：原素材名，有效编号紧凑重排", () => {
    const mentions = [mention(0, 3, "media-i1", "9001"), mention(10, 13, "media-i2", "9002"), mention(20, 23, "media-i3", "9003")];
    const refs = [ref("media-i1", "9001", "image"), ref("media-i2", "9002", "image", "猫咪原图"), ref("media-i3", "9003", "image")];
    const labels = deriveMediaMentionLabels(mentions, refs, nodeId => nodeId !== "media-i2");
    expect(labels.get("media-i1")).toBe("图片1");
    expect(labels.get("media-i2")).toBe("已失效：猫咪原图");
    expect(labels.get("media-i3")).toBe("图片2");
  });

  it("ref 缺失按失效兜底，不抛异常", () => {
    const labels = deriveMediaMentionLabels([mention(0, 3, "media-x", "9001")], [], allValid);
    expect(labels.get("media-x")).toBe(invalidMediaMentionLabel("未知素材"));
  });

  it("按序变体：与区间派生语义一致（编辑器 DOM 顺序场景）", () => {
    const identities = [
      { nodeId: "media-i2", assetId: "9002" },
      { nodeId: "media-i1", assetId: "9001" },
      { nodeId: "media-v1", assetId: "9003" },
    ];
    const refs = [ref("media-i1", "9001", "image"), ref("media-i2", "9002", "image"), ref("media-v1", "9003", "video")];
    const labels = deriveMediaMentionLabelsInOrder(identities, refs, nodeId => nodeId !== "media-i2");
    expect(labels.get("media-i2")).toBe("已失效：素材名");
    expect(labels.get("media-i1")).toBe("图片1");
    expect(labels.get("media-v1")).toBe("视频1");
  });
});
