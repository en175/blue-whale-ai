import { describe, it, expect, vi } from "vitest";
import { resolveInputs, topoSort, runNode, runGroup, toRecipeInputs, buildGenerationRecipe, type RunCtx } from "./engine";
import type { Asset, CanvasNode, CanvasEdge } from "./model";

const asset = (id: string, kind: Asset["kind"], src: string): Asset => ({ id, kind, src });
const media = (id: string, kind: CanvasNode["type"], data: Record<string, unknown> = {}): CanvasNode => ({
  id,
  type: kind,
  position: { x: 0, y: 0 },
  data: { kind, ...data },
});

describe("run-engine / resolveInputs", () => {
  it("reads upstream asset without side effects", () => {
    const upstream = media("a", "text", { assetId: "at" });
    const target = media("b", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "a", target: "b", targetHandle: "prompt" }];
    const inputs = resolveInputs(target, [upstream, target], edges, { at: asset("at", "text", "hello") });
    expect(inputs.prompt).toEqual(asset("at", "text", "hello"));
  });

  it("text 上游 data.prompt 物化成 text Asset（无 assetId 也流 prompt）", () => {
    const upstream = media("t", "text", { prompt: "画一只猫" });
    const target = media("i", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "t", target: "i", sourceHandle: "text", targetHandle: "prompt" }];
    const inputs = resolveInputs(target, [upstream, target], edges, {});
    expect(inputs.prompt).toEqual({ id: "t", kind: "text", src: "画一只猫" });
  });
});

describe("run-engine / topoSort", () => {
  it("returns null on cycle", () => {
    expect(topoSort(["a", "b"], [{ source: "a", target: "b" }, { source: "b", target: "a" }])).toBeNull();
  });
  it("returns order with upstream before downstream", () => {
    expect(topoSort(["a", "b", "c"], [{ source: "a", target: "b" }, { source: "b", target: "c" }])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("run-engine / runNode", () => {
  it("calls generate exactly once, no upstream cascade", async () => {
    const generate = vi.fn().mockResolvedValue(asset("out", "image", "u"));
    const ctx: RunCtx = {
      getNodes: () => [media("b", "image")],
      getEdges: () => [],
      getAssets: () => ({}),
      generate,
      updateNode: () => {},
    };
    await runNode("b", ctx);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("run-engine / runGroup", () => {
  it("runs members topologically with cascade", async () => {
    const calls: string[] = [];
    const generate = vi.fn((id: string) => {
      calls.push(id);
      return Promise.resolve(asset(id, "image", "u"));
    });
    const a: CanvasNode = { id: "a", type: "image", position: { x: 0, y: 0 }, parentId: "g", data: { kind: "image" } };
    const b: CanvasNode = { id: "b", type: "image", position: { x: 0, y: 0 }, parentId: "g", data: { kind: "image" } };
    const ctx: RunCtx = {
      getNodes: () => [a, b],
      getEdges: () => [{ id: "e1", source: "a", target: "b" }],
      getAssets: () => ({}),
      generate,
      updateNode: () => {},
    };
    await runGroup("g", ctx);
    expect(calls).toEqual(["a", "b"]);
  });
});

describe("run-engine / toRecipeInputs", () => {
  it("prompt 来自文本节点（assetId）→ {kind:text,nodeId,text}", () => {
    const upstream = media("t", "text", { assetId: "at" });
    const target = media("i", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "t", target: "i", targetHandle: "prompt" }];
    const ri = toRecipeInputs(target, [upstream, target], edges, { at: asset("at", "text", "画猫") });
    expect(ri.prompt).toEqual({ kind: "text", nodeId: "t", text: "画猫" });
  });

  it("prompt 来自文本节点 data.prompt（无 assetId）→ text 快照", () => {
    const upstream = media("t", "text", { prompt: "画狗" });
    const target = media("i", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "t", target: "i", targetHandle: "prompt" }];
    const ri = toRecipeInputs(target, [upstream, target], edges, {});
    expect(ri.prompt).toEqual({ kind: "text", nodeId: "t", text: "画狗" });
  });

  it("firstFrame 来自画布图片节点 → {kind:image,nodeId,assetId,url}", () => {
    const upstream = media("ff", "image", { assetId: "aff" });
    const target = media("v", "video");
    const edges: CanvasEdge[] = [{ id: "e1", source: "ff", target: "v", targetHandle: "firstFrame" }];
    const ri = toRecipeInputs(target, [upstream, target], edges, { aff: asset("aff", "image", "https://tos/ff.png") });
    expect(ri.firstFrame).toEqual({ kind: "image", nodeId: "ff", assetId: "aff", url: "https://tos/ff.png" });
  });

  it("reference handle 归 references[]", () => {
    const r1 = media("r1", "image", { assetId: "ar1" });
    const target = media("i", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "r1", target: "i", targetHandle: "reference" }];
    const ri = toRecipeInputs(target, [r1, target], edges, { ar1: asset("ar1", "image", "u1") });
    expect(ri.references).toHaveLength(1);
    expect(ri.references?.[0]).toMatchObject({ kind: "image", nodeId: "r1", assetId: "ar1" });
  });

  it("上游节点缺失（已删）→ 该 input 省略，不崩", () => {
    const target = media("i", "image");
    const edges: CanvasEdge[] = [{ id: "e1", source: "ghost", target: "i", targetHandle: "prompt" }];
    const ri = toRecipeInputs(target, [target], edges, {});
    expect(ri.prompt).toBeUndefined();
  });
});

describe("run-engine / buildGenerationRecipe", () => {
  it("组装 generated recipe（origin/model/params/inputs/jobId/generatedAt）", () => {
    const r = buildGenerationRecipe({
      mediaKind: "image",
      model: "m1",
      params: { aspectRatio: "16:9", resolution: "1080p", quantity: 1 },
      inputs: { prompt: { kind: "text", text: "猫" } },
      jobId: "j1",
      generatedAt: "2026-07-22T00:00:00Z",
    });
    expect(r).toEqual({
      origin: "generated",
      generation: {
        mediaKind: "image",
        model: "m1",
        params: { aspectRatio: "16:9", resolution: "1080p", quantity: 1 },
        inputs: { prompt: { kind: "text", text: "猫" } },
        jobId: "j1",
        generatedAt: "2026-07-22T00:00:00Z",
      },
    });
  });

  it("generatedAt 缺省取当前时间（非空）", () => {
    const r = buildGenerationRecipe({ mediaKind: "video", model: "m2", params: { aspectRatio: "16:9", resolution: "1080p", duration: 5, refMode: "none" }, inputs: {} });
    expect(r.origin).toBe("generated");
    expect(r.generation?.generatedAt).toBeTruthy();
  });
});
