/**
 * v2 mappers 单测：job → CanvasNodeData 占位（status=running 非 loading）、
 * card → 图片节点字段。不改老 recover.ts/nodeFromCard.ts（strangler 老不动）。
 */
import { describe, it, expect } from "vitest";
import { jobToV2Placeholder, cardToV2ImageFields, recipeToDockPrefill, buildCrossmodalRefill, dockMediaToRecipeRefs } from "./mappers";
import type { JobListItem } from "../api/generation";
import type { CardMessage } from "../nodeFromCard";
import type { GenerationRecipe } from "../model";
import type { DockMediaItem } from "../types";

const job = (over: Partial<JobListItem>): JobListItem =>
  ({
    jobId: 1,
    type: "image",
    status: "processing",
    progress: 0,
    input: { prompt: "", aspectRatio: "1:1" },
    createdAt: "",
    outputAssets: null,
    ...over,
  }) as JobListItem;

describe("dockMediaToRecipeRefs", () => {
  it("从画布选（带 nodeId）→ recipe refs 带 nodeId + assetId + url", () => {
    const refs = dockMediaToRecipeRefs([
      { id: "d1", type: "image", name: "猫图", src: "u1.png", nodeId: "n_cat", assetId: 95 } as DockMediaItem,
    ]);
    expect(refs).toEqual([{ kind: "image", nodeId: "n_cat", assetId: "95", url: "u1.png" }]);
  });

  it("上传参考（无 nodeId）→ recipe refs assetId + url 兜底（无 nodeId）", () => {
    const refs = dockMediaToRecipeRefs([
      { id: "d2", type: "audio", name: "bgm.mp3", src: "a1.mp3", assetId: 12 } as DockMediaItem,
    ]);
    expect(refs).toEqual([{ kind: "audio", nodeId: undefined, assetId: "12", url: "a1.mp3" }]);
  });

  it("无 src 的跳过（防 recipe 记空 url）", () => {
    const refs = dockMediaToRecipeRefs([{ id: "d3", type: "image", name: "无图" } as DockMediaItem]);
    expect(refs).toEqual([]);
  });
});

describe("jobToV2Placeholder", () => {
  it("image job：status=running（非 loading），无 progress，尺寸按 aspectRatio，id=job-{jobId}", () => {
    const ph = jobToV2Placeholder(job({ jobId: 5, type: "image", input: { prompt: "猫", aspectRatio: "16:9" } }));
    expect(ph.id).toBe("job-5");
    expect(ph.kind).toBe("image");
    expect(ph.data.status).toBe("running");
    expect(ph.data.content).toBe("猫");
    expect(ph.data.progress).toBeUndefined();
    expect(ph.width / ph.height).toBeCloseTo(16 / 9, 1);
  });

  it("video job：status=running + progress", () => {
    const ph = jobToV2Placeholder(job({ jobId: 6, type: "video", progress: 40 }));
    expect(ph.kind).toBe("video");
    expect(ph.data.status).toBe("running");
    expect(ph.data.progress).toBe(40);
  });

  it("input 缺失：回退空 prompt + 1:1", () => {
    const ph = jobToV2Placeholder(job({ jobId: 7, input: null }));
    expect(ph.data.content).toBe("");
    expect(ph.width).toBeGreaterThan(0);
  });
});

describe("cardToV2ImageFields", () => {
  it("尺寸按 meta 比例 + content=card.text", () => {
    const card = { id: 1, type: "card", text: "一只狗", meta: "1:1" } as CardMessage;
    const f = cardToV2ImageFields(card);
    expect(f.content).toBe("一只狗");
    expect(f.width).toBeGreaterThan(0);
    expect(f.height).toBeGreaterThan(0);
  });
});

describe("recipeToDockPrefill", () => {
  it("image recipe → prompt/model/比例/分辨率/数量", () => {
    const gen: GenerationRecipe = {
      mediaKind: "image",
      model: "doubao-seedream-5-0",
      params: { aspectRatio: "1:1", resolution: "2k", quantity: 1 },
      inputs: { prompt: { kind: "text", text: "小牛" } },
    };
    expect(recipeToDockPrefill(gen)).toMatchObject({
      prompt: "小牛",
      modelId: "doubao-seedream-5-0",
      aspectRatio: "1:1",
      resolution: "2k",
      quantity: 1,
    });
  });

  it("video recipe + 首帧/参考 → duration/refMode/firstFrame/references", () => {
    const gen: GenerationRecipe = {
      mediaKind: "video",
      model: "kling-v2",
      params: { aspectRatio: "16:9", resolution: "1080p", duration: 5, refMode: "firstlast" },
      inputs: {
        prompt: { kind: "text", text: "动起来" },
        firstFrame: { kind: "image", url: "https://tos/ff.png" },
        references: [{ kind: "image", url: "https://tos/r.png" }],
      },
    };
    const p = recipeToDockPrefill(gen);
    expect(p).toMatchObject({ duration: 5, refMode: "firstlast", firstFrameUrl: "https://tos/ff.png" });
    expect(p.references).toEqual([{ url: "https://tos/r.png", kind: "image" }]);
  });

  it("带参考图的 image recipe → referenceUrls", () => {
    const gen: GenerationRecipe = {
      mediaKind: "image",
      model: "m",
      params: { aspectRatio: "1:1", resolution: "2k", quantity: 1 },
      inputs: { prompt: { kind: "text", text: "@[小牛] 吃草" }, references: [{ kind: "image", url: "https://tos/a.png" }] },
    };
    expect(recipeToDockPrefill(gen).references).toEqual([{ url: "https://tos/a.png", kind: "image" }]);
  });

  it("缺字段不崩（空 params/inputs）", () => {
    const gen: GenerationRecipe = { mediaKind: "image", model: "", params: {}, inputs: {} };
    const p = recipeToDockPrefill(gen);
    expect(p.prompt).toBeUndefined();
    expect(p.modelId).toBe("");
    expect(p.references).toBeUndefined();
  });
});

describe("buildCrossmodalRefill（D 跨模态点击式）", () => {
  const img = { id: "i1", data: { kind: "image" as const, content: "猫", assetId: "a1" } };
  const vid = { id: "v1", data: { kind: "video" as const, content: "风景", assetId: "a2" } };
  const aud = { id: "u1", data: { kind: "audio" as const, content: "旁白", assetId: "a3" } };

  it("图片→生成视频: mode=video, media[type=image]", () => {
    expect(buildCrossmodalRefill(img, "video", "url-i")).toEqual({ mode: "video", media: { id: "i1", type: "image", name: "猫", src: "url-i" } });
  });
  it("图片→生成音频: mode=audio, media[type=image]", () => {
    expect(buildCrossmodalRefill(img, "audio", "url-i")).toEqual({ mode: "audio", media: { id: "i1", type: "image", name: "猫", src: "url-i" } });
  });
  it("视频→生成视频: mode=video, media[type=video]", () => {
    expect(buildCrossmodalRefill(vid, "video", "url-v")).toEqual({ mode: "video", media: { id: "v1", type: "video", name: "风景", src: "url-v" } });
  });
  it("音频→生成视频: mode=video, media[type=audio]", () => {
    expect(buildCrossmodalRefill(aud, "video", "url-u")).toEqual({ mode: "video", media: { id: "u1", type: "audio", name: "旁白", src: "url-u" } });
  });
  it("视频→提取音频: derived=true", () => {
    expect(buildCrossmodalRefill(vid, "extract-audio", "url-v")).toEqual({ derived: true });
  });
  it("无 src → null（video/audio 需 src 带参考）", () => {
    expect(buildCrossmodalRefill(img, "video", undefined)).toBeNull();
  });
  it("非跨模态 action → null", () => {
    expect(buildCrossmodalRefill(img, "download", "url")).toBeNull();
  });
});
