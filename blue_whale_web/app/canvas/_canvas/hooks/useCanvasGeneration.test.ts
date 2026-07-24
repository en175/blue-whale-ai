// @vitest-environment jsdom
/**
 * useCanvasGeneration 单测（ADR-0027 / openspec canvas-generation-hook）。
 *
 * seam = hook 公开 generate / generateFromNode：mock 注入 deps（addNode/patchNode/addAsset）
 * + mock api/generation 模块，断言 generate 副作用序列（建 running 占位 + API 入参 +
 * 写 assetId/done/recipe）。仿 useVideoJobs.test 惯例（renderHook + act + vi.mock）。
 *
 * 对照旧 page.tsx：生成 3 路径 + setNodeAsset + startVideoJob 全堆 page（不可测）；
 * 抽到 hook 后通过注入边界可测，行为不变（重构的安全网）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasGeneration } from "./useCanvasGeneration";
import type { CanvasNode, CanvasEdge, Asset } from "../model";
import type { GenerateArgs } from "../types";
import * as generation from "../api/generation";

// mock useVideoJobs（hook 内聚的轮询层）：避免 generate video 触发真实 setInterval 轮询，
// startVideoJob 编排通过 mockJobs.start 被调验证（轮询细节由 useVideoJobs.test 覆盖）。
const { mockJobs } = vi.hoisted(() => ({
  mockJobs: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), activeCount: vi.fn(() => 0) },
}));
vi.mock("./useVideoJobs", () => ({ useVideoJobs: () => mockJobs }));

vi.mock("../api/generation", () => ({
  generateImage: vi.fn(),
  createVideoJob: vi.fn(),
  generateAudio: vi.fn(),
  getImageModels: vi.fn(),
  getVideoModels: vi.fn(),
  streamJob: vi.fn(),
  listJobs: vi.fn(),
  getJobStatus: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

type Deps = {
  addNode: ReturnType<typeof vi.fn>;
  patchNode: ReturnType<typeof vi.fn>;
  addAsset: ReturnType<typeof vi.fn>;
  ensureAsset: ReturnType<typeof vi.fn>;
};

function renderGen(overrides: { nodes?: CanvasNode[]; edges?: CanvasEdge[]; assets?: Record<string, Asset>; ensureAsset?: ReturnType<typeof vi.fn> } = {}) {
  // addNode 返回占位 id（page 真实 addNode 返回 n_xxx；mock 须尊重该返回值契约）
  const addNode = vi.fn().mockReturnValue("n_ph");
  const patchNode = vi.fn();
  const addAsset = vi.fn();
  const ensureAsset = overrides.ensureAsset ?? vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useCanvasGeneration({
      nodes: overrides.nodes ?? [],
      edges: overrides.edges ?? [],
      assets: overrides.assets ?? {},
      addNode: addNode as unknown as Deps["addNode"],
      patchNode: patchNode as unknown as Deps["patchNode"],
      addAsset: addAsset as unknown as Deps["addAsset"],
      ensureAsset: ensureAsset as unknown as Deps["ensureAsset"],
      projectId: "1",
    }),
  );
  return { result, addNode, patchNode, addAsset, ensureAsset };
}

const imageArgs: GenerateArgs = {
  mode: "image",
  settings: {
    model: { id: "m1", label: "M1" },
    resolution: { id: "1080p", label: "1080p" },
    aspectRatio: { id: "1:1", label: "1:1" },
    quantity: "1",
  },
};

describe("useCanvasGeneration.generate", () => {
  it("非流式：建 running 占位 + generateImage + 写 assetId/done/recipe", async () => {
    (generation.generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ url: "u.png", assetId: 42 });
    const { result, addNode, patchNode, addAsset } = renderGen();

    await act(async () => {
      await result.current.generate("画一只猫", imageArgs);
    });

    // 建占位节点（kind=image，running）
    expect(addNode).toHaveBeenCalledWith("image", expect.objectContaining({ data: expect.objectContaining({ content: "画一只猫", status: "running" }) }));
    // generateImage 入参（projectId Number 化 + 各 settings.id）
    expect(generation.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "画一只猫", projectId: 1, modelId: "m1", sizeId: "1080p", aspectRatio: "1:1", quantity: 1 }),
    );
    // 注册 asset（assetId 全链路 String）
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "42", kind: "image", src: "u.png", source: "generated" }));
    // patchNode 写 assetId/done
    expect(patchNode).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ assetId: "42", status: "done" }));
    // recipe 随生成冻结写回（image + modelId）
    const recipeCall = patchNode.mock.calls.find((c) => (c[1] as { recipe?: unknown }).recipe);
    expect(recipeCall?.[1]).toMatchObject({ recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } } });
    // generating 复位（非流式同步完成）
    expect(result.current.generating).toBe(false);
  });

  it("video：createVideoJob + 建占位带 recipe + startVideoJob 后台轮询", async () => {
    (generation.createVideoJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: 777, status: "queued" });
    const { result, addNode } = renderGen();
    const args: GenerateArgs = {
      mode: "video",
      settings: { model: { id: "v1", label: "V1" }, resolution: { id: "720p", label: "720p" }, aspectRatio: { id: "16:9", label: "16:9" }, duration: 5, quantity: "1", refMode: { id: "none", label: "无" } },
    };
    await act(async () => {
      await result.current.generate("做个视频", args);
    });
    expect(generation.createVideoJob).toHaveBeenCalledWith(expect.objectContaining({ prompt: "做个视频", projectId: 1, modelId: "v1", duration: 5 }));
    // 建占位（running + progress 0）
    expect(addNode).toHaveBeenCalledWith("video", expect.objectContaining({ data: expect.objectContaining({ content: "做个视频", status: "running", progress: 0, taskId: "777" }) }));
    // recipe 创建即写节点（视频发起那刻全有，窗口期也带溯源）
    const vCall = addNode.mock.calls.find((c) => c[0] === "video");
    expect((vCall?.[1] as { data: { recipe?: unknown } }).data.recipe).toMatchObject({ origin: "generated", generation: { mediaKind: "video", model: "v1" } });
    // startVideoJob 触发（useVideoJobs.start 被 startVideoJob 调，jobId 闭包注入）
    expect(mockJobs.start).toHaveBeenCalledWith(777, expect.objectContaining({ onSucceeded: expect.any(Function), onFailed: expect.any(Function) }));
    // 视频转后台轮询，generating 复位（不阻塞后续并发生成）
    expect(result.current.generating).toBe(false);
  });

  it("audio：建占位 + generateAudio + 写 assetId/done/recipe", async () => {
    (generation.generateAudio as ReturnType<typeof vi.fn>).mockResolvedValue({ url: "a.mp3", assetId: 9 });
    const { result, addNode, patchNode, addAsset } = renderGen();
    const args: GenerateArgs = {
      mode: "audio",
      settings: { model: { id: "a1", label: "A1" }, duration: 5, sampleRate: 44100, format: { id: "mp3", label: "MP3" } },
    };
    await act(async () => {
      await result.current.generate("生成音乐", args);
    });
    expect(addNode).toHaveBeenCalledWith("audio", expect.objectContaining({ data: expect.objectContaining({ content: "生成音乐", status: "running" }) }));
    expect(generation.generateAudio).toHaveBeenCalledWith(expect.objectContaining({ prompt: "生成音乐", projectId: 1, modelId: "a1", duration: 5, sampleRate: 44100, format: "mp3" }));
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "9", kind: "audio", src: "a.mp3", source: "generated" }));
    expect(patchNode).toHaveBeenCalledWith("n_ph", expect.objectContaining({ assetId: "9", status: "done" }));
    expect(result.current.generating).toBe(false);
  });
});

describe("useCanvasGeneration.generateFromNode", () => {
  it("无上游 prompt → 报错不生成（不调 API）", async () => {
    const img1 = { id: "img1", type: "image", position: { x: 0, y: 0 }, data: { kind: "image" } } as unknown as CanvasNode;
    const { result } = renderGen({ nodes: [img1] });
    await act(async () => {
      await result.current.generateFromNode("img1");
    });
    expect(result.current.generateError).toBe("请先连一个文本节点作 prompt");
    expect(generation.generateImage).not.toHaveBeenCalled();
  });

  it("image：取上游 text prompt → getImageModels + generateImage + 写 assetId/done/recipe", async () => {
    (generation.getImageModels as ReturnType<typeof vi.fn>).mockResolvedValue([{ modelId: "m1", defaultSize: "1080p", defaultAspectRatio: "1:1" }]);
    (generation.generateImage as ReturnType<typeof vi.fn>).mockResolvedValue({ url: "u.png", assetId: 42 });
    const t1 = { id: "t1", type: "text", position: { x: 0, y: 0 }, data: { kind: "text", prompt: "画猫" } } as unknown as CanvasNode;
    const img1 = { id: "img1", type: "image", position: { x: 0, y: 0 }, data: { kind: "image" } } as unknown as CanvasNode;
    const e1 = { id: "e1", source: "t1", target: "img1", targetHandle: "prompt" } as CanvasEdge;
    const { result, patchNode, addAsset } = renderGen({ nodes: [t1, img1], edges: [e1] });
    await act(async () => {
      await result.current.generateFromNode("img1");
    });
    expect(generation.getImageModels).toHaveBeenCalled();
    expect(generation.generateImage).toHaveBeenCalledWith(expect.objectContaining({ prompt: "画猫", projectId: 1, modelId: "m1", quantity: 1 }));
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "42", kind: "image", src: "u.png", source: "generated" }));
    expect(patchNode).toHaveBeenCalledWith("img1", expect.objectContaining({ assetId: "42", status: "done" }));
    const recipeCall = patchNode.mock.calls.find((c) => (c[1] as { recipe?: unknown }).recipe);
    expect(recipeCall?.[1]).toMatchObject({ recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } } });
    expect(result.current.generating).toBe(false);
  });

  it("video：取上游 prompt → getVideoModels + createVideoJob + 写 taskId + startVideoJob", async () => {
    (generation.getVideoModels as ReturnType<typeof vi.fn>).mockResolvedValue([{ modelId: "v1", defaultResolution: "720p", defaultAspectRatio: "16:9", defaultDuration: 5 }]);
    (generation.createVideoJob as ReturnType<typeof vi.fn>).mockResolvedValue({ jobId: 888, status: "queued" });
    const t1 = { id: "t1", type: "text", position: { x: 0, y: 0 }, data: { kind: "text", prompt: "做视频" } } as unknown as CanvasNode;
    const vid = { id: "vid1", type: "video", position: { x: 0, y: 0 }, data: { kind: "video" } } as unknown as CanvasNode;
    const e1 = { id: "e1", source: "t1", target: "vid1", targetHandle: "prompt" } as CanvasEdge;
    const { result, patchNode } = renderGen({ nodes: [t1, vid], edges: [e1] });
    await act(async () => {
      await result.current.generateFromNode("vid1");
    });
    expect(generation.createVideoJob).toHaveBeenCalledWith(expect.objectContaining({ prompt: "做视频", projectId: 1 }));
    // 写 taskId 关联 job（刷新 recover by taskId）
    expect(patchNode).toHaveBeenCalledWith("vid1", expect.objectContaining({ taskId: "888" }));
    expect(mockJobs.start).toHaveBeenCalledWith(888, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(result.current.generating).toBe(false);
  });
});

describe("useCanvasGeneration.recover", () => {
  it("existing 节点 taskId 匹配 job → 恢复 status=running + 续轮询（不建重复）", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { jobId: 130, type: "video", status: "processing", progress: 30, input: { prompt: "猫" }, createdAt: "", outputAssets: null },
    ]);
    const existing = { id: "n_vid", type: "video", position: { x: 0, y: 0 }, width: 356, height: 200, data: { kind: "video", taskId: "130", content: "猫" } } as unknown as CanvasNode;
    const { result, patchNode, addNode } = renderGen({ nodes: [existing] });
    await act(async () => {
      await result.current.recover([existing]);
    });
    // 恢复 running（serialize 不持久 status，刷新后丢，recover 恢复）+ 续轮询
    expect(patchNode).toHaveBeenCalledWith("n_vid", expect.objectContaining({ status: "running", progress: 0 }));
    expect(mockJobs.start).toHaveBeenCalledWith(130, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(addNode).not.toHaveBeenCalled(); // byTaskId 匹配 → 不建重复占位
  });

  it("无 taskId 匹配（老数据/来源不明）→ 建 job-{jobId} 占位 + taskId + 续轮询", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { jobId: 200, type: "video", status: "processing", progress: 0, input: { prompt: "新视频", aspectRatio: "16:9" }, createdAt: "", outputAssets: null },
    ]);
    const { result, addNode } = renderGen({ nodes: [] });
    await act(async () => {
      await result.current.recover([]);
    });
    expect(addNode).toHaveBeenCalledWith("video", expect.objectContaining({ id: "job-200", data: expect.objectContaining({ taskId: "200" }) }));
    expect(mockJobs.start).toHaveBeenCalledWith(200, expect.objectContaining({ onSucceeded: expect.any(Function) }));
  });
});

describe("useCanvasGeneration.reconcile", () => {
  it("succeeded job + 节点有 taskId 无 assetId → 写 assetId/done（防永卡）", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { jobId: 130, type: "video", status: "succeeded", progress: 100, input: {}, createdAt: "", outputAssets: [{ id: 555, url: "v555.mp4", type: "video" }] },
    ]);
    const stuck = { id: "n_vid", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "130" /* 无 assetId：回调没跑 */ } } as unknown as CanvasNode;
    const { result, patchNode, addAsset } = renderGen({ nodes: [stuck] });
    await act(async () => {
      await result.current.reconcile([stuck]);
    });
    expect(patchNode).toHaveBeenCalledWith("n_vid", expect.objectContaining({ assetId: "555", status: "done" }));
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "555", kind: "video", src: "v555.mp4", source: "generated" }));
  });

  it("无候选（节点已 done 有 assetId）→ 不查 listJobs", async () => {
    const done = { id: "n_ok", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "130", assetId: "555" } } as unknown as CanvasNode;
    const { result } = renderGen({ nodes: [done] });
    await act(async () => {
      await result.current.reconcile([done]);
    });
    expect(generation.listJobs).not.toHaveBeenCalled();
  });
});

describe("useCanvasGeneration.hydrate", () => {
  it("load 后统一水合：ensureAsset 有 assetId + recover(processing) + reconcile(succeeded)", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const ensureAsset = vi.fn().mockResolvedValue(undefined);
    const nodes = [
      { id: "n1", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", assetId: "95" } } as unknown as CanvasNode,
      { id: "n2", type: "image", position: { x: 0, y: 0 }, data: { kind: "image" } } as unknown as CanvasNode, // 无 assetId（ensureAsset 跳过）
      { id: "n3", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "200" } } as unknown as CanvasNode, // reconcile 候选（taskId 无 assetId）
    ];
    const { result } = renderGen({ nodes, ensureAsset });
    await act(async () => {
      await result.current.hydrate(nodes);
    });
    // ensureAsset 只调有 assetId 的（n1）
    expect(ensureAsset).toHaveBeenCalledTimes(1);
    expect(ensureAsset).toHaveBeenCalledWith("95");
    // recover(processing) + reconcile(succeeded) 各 listJobs 一次
    expect(generation.listJobs).toHaveBeenCalledTimes(2);
  });
});
