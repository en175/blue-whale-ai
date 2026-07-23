/**
 * v2 mappers 单测：job → CanvasNodeData 占位（status=running 非 loading）、
 * card → 图片节点字段。不改老 recover.ts/nodeFromCard.ts（strangler 老不动）。
 */
import { describe, it, expect } from "vitest";
import { jobToV2Placeholder, cardToV2ImageFields, recipeToDockPrefill } from "./mappers";
import type { JobListItem } from "../api/generation";
import type { CardMessage } from "../nodeFromCard";
import type { GenerationRecipe } from "../model";

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
