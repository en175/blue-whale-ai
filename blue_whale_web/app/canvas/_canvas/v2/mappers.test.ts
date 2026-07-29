/**
 * v2 mappers 单测：job → CanvasNodeData 占位（status=running 非 loading）、
 * card → 图片节点字段。不改老 recover.ts/nodeFromCard.ts（strangler 老不动）。
 */
import { describe, it, expect } from "vitest";
import {
  jobToV2Placeholder,
  cardToV2ImageFields,
  recipeToDockPrefill,
  buildCrossmodalRefill,
  canvasNodeToDockMedia,
  dockMediaToRecipeRefs,
} from "./mappers";
import type { JobListItem } from "../api/generation";
import type { CardMessage } from "../nodeFromCard";
import type { GenerationRecipe } from "../model";

const job = (over: Partial<JobListItem>): JobListItem =>
  ({
    job_id: "1",
    type: "image",
    status: "processing",
    progress: 0,
    input: { parameters: { prompt: "", aspect_ratio: "1:1" } },
    created_at: "",
    output_assets: [],
    ...over,
  }) as JobListItem;

describe("dockMediaToRecipeRefs", () => {
  it("带 assetId → recipe refs assetId + url", () => {
    const refs = dockMediaToRecipeRefs([
      { id: "d1", type: "image", name: "猫图", src: "u1.png", assetId: "95" },
    ]);
    expect(refs).toEqual([{ kind: "image", assetId: "95", url: "u1.png" }]);
  });

  it("上传参考（无 assetId）→ recipe refs 仅 url 兜底", () => {
    const refs = dockMediaToRecipeRefs([
      { id: "d2", type: "audio", name: "bgm.mp3", src: "a1.mp3" },
    ]);
    expect(refs).toEqual([{ kind: "audio", assetId: undefined, url: "a1.mp3" }]);
  });

  it("无 src 的跳过（防 recipe 记空 url）", () => {
    const refs = dockMediaToRecipeRefs([{ id: "d3", type: "image", name: "无图" }]);
    expect(refs).toEqual([]);
  });
});

describe("jobToV2Placeholder", () => {
  it("image job：status=running（非 loading），无 progress，尺寸按 aspect_ratio，id=job-{job_id}", () => {
    const ph = jobToV2Placeholder(job({ job_id: "5", type: "image", input: { parameters: { prompt: "猫", aspect_ratio: "16:9" } } }));
    expect(ph.id).toBe("job-5");
    expect(ph.kind).toBe("image");
    expect(ph.data.status).toBe("running");
    expect(ph.data.content).toBe("猫");
    expect(ph.data.progress).toBeUndefined();
    expect(ph.width / ph.height).toBeCloseTo(16 / 9, 1);
  });

  it("video job：status=running + progress", () => {
    const ph = jobToV2Placeholder(job({ job_id: "6", type: "video", progress: 40 }));
    expect(ph.kind).toBe("video");
    expect(ph.data.status).toBe("running");
    expect(ph.data.progress).toBe(40);
  });

  it("input 缺失：回退空 prompt + 1:1", () => {
    const ph = jobToV2Placeholder(job({ job_id: "7", input: null }));
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
        firstFrame: { kind: "image", assetId: "90", url: "https://tos/ff.png" },
        lastFrame: { kind: "image", assetId: "92", url: "https://tos/lf.png" },
        references: [{ kind: "image", assetId: "91", url: "https://tos/r.png" }],
      },
    };
    const p = recipeToDockPrefill(gen);
    expect(p).toMatchObject({
      duration: 5,
      refMode: "firstlast",
      firstFrameUrl: "https://tos/ff.png",
      firstFrameAssetId: "90",
      lastFrameUrl: "https://tos/lf.png",
      lastFrameAssetId: "92",
    });
    expect(p.references).toEqual([
      { url: "https://tos/r.png", kind: "image", assetId: "91" },
    ]);
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
    expect(buildCrossmodalRefill(aud, "video", "url-u")).toBeNull();
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

describe("canvasNodeToDockMedia", () => {
  it("preserves a selected video node's trusted kind and Asset identity", () => {
    expect(
      canvasNodeToDockMedia(
        {
          id: "video-node",
          data: {
            kind: "video",
            content: "参考运镜",
            assetId: "42",
          },
        },
        "https://tos.test/reference.mp4",
      ),
    ).toEqual({
      id: "video-node",
      type: "video",
      name: "参考运镜",
      src: "https://tos.test/reference.mp4",
      assetId: "42",
    });
  });
});
