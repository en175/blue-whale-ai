// @vitest-environment jsdom
/**
 * useCanvasGeneration 单测（ADR-0027 / openspec canvas-generation-hook）。
 *
 * IK4AK6 接 Node 生成 API：image/video 都走 createProjectGenerationJob（Node 全异步）→ useVideoJobs 轮询
 * getJobStatus；audio 仍 mock（generateAudio）。本测把 useVideoJobs 整体 mock（避免真实 setInterval），
 * 通过捕获 mockJobs.start 的回调手动触发 onSucceeded/onFailed 验证出图/报错副作用。
 *
 * seam = hook 公开 generate / generateFromNode / recover / reconcile / hydrate：
 * mock 注入 deps（addNode/patchNode/addAsset）+ mock api/generation，断言副作用序列。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasGeneration } from "./useCanvasGeneration";
import { parse, serialize, type CanvasNode, type CanvasEdge, type Asset } from "../model";
import type { GenerateArgs } from "../types";
import * as generation from "../api/generation";

// mock useVideoJobs（hook 内聚的轮询层）：避免真实 setInterval 轮询。
// start 捕获回调，测试手动触发 onSucceeded/onFailed 验证出图/报错。
const { mockJobs, mockLoadSnapshot } = vi.hoisted(() => ({
  mockJobs: { start: vi.fn(), stop: vi.fn(), stopAll: vi.fn(), activeCount: vi.fn(() => 0) },
  mockLoadSnapshot: vi.fn().mockResolvedValue({ assets: {} }),
}));
vi.mock("./useVideoJobs", () => ({ useVideoJobs: () => mockJobs }));
vi.mock("@/lib/project-recovery", () => ({
  projectRecoveryTransport: { loadSnapshot: mockLoadSnapshot },
}));

vi.mock("../api/generation", () => ({
  cancelProjectGenerationJob: vi.fn(),
  createProjectGenerationJob: vi.fn(),
  generateAudio: vi.fn(),
  getImageModels: vi.fn(),
  getVideoModels: vi.fn(),
  listJobs: vi.fn(),
  getJobStatus: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

type Deps = {
  addNode: ReturnType<typeof vi.fn>;
  patchNode: ReturnType<typeof vi.fn>;
  patchNodeAndSave: ReturnType<typeof vi.fn>;
  addAsset: ReturnType<typeof vi.fn>;
};

function renderGen(overrides: { nodes?: CanvasNode[]; edges?: CanvasEdge[]; assets?: Record<string, Asset>; projectId?: string } = {}) {
  // addNode 返回占位 id（page 真实 addNode 返回 n_xxx；mock 须尊重该返回值契约）
  const addNode = vi.fn().mockReturnValue("n_ph");
  const patchNode = vi.fn();
  const patchNodeAndSave = vi.fn().mockResolvedValue(undefined);
  const addAsset = vi.fn();
  const deps = {
    nodes: overrides.nodes ?? [],
    edges: overrides.edges ?? [],
    assets: overrides.assets ?? {},
    addNode: addNode as unknown as Deps["addNode"],
    patchNode: patchNode as unknown as Deps["patchNode"],
    patchNodeAndSave: patchNodeAndSave as unknown as Deps["patchNodeAndSave"],
    addAsset: addAsset as unknown as Deps["addAsset"],
    projectId: overrides.projectId ?? "1",
  };
  const { result } = renderHook(() =>
    useCanvasGeneration(deps),
  );
  return { result, addNode, patchNode, patchNodeAndSave, addAsset };
}

const imageArgs: GenerateArgs = {
  mode: "image",
  inputAssetIds: [9],
  settings: {
    aspectRatio: { id: "1:1", label: "1:1" },
    quantity: "1",
    modelId: "m1",
    size: "2k",
    webSearch: false,
    sequential: false,
  },
};

const videoArgs: GenerateArgs = {
  mode: "video",
  inputAssetIds: [11],
  settings: {
    model: { id: "v1", label: "V1" },
    resolution: { id: "720p", label: "720p" },
    aspectRatio: { id: "16:9", label: "16:9" },
    duration: 5,
    quantity: "1",
    refMode: { id: "none", label: "无" },
  },
};

const videoFrameArgs: GenerateArgs = {
  mode: "video",
  inputAssetIds: [11, 12, 13],
  firstFrameAssetId: 11,
  lastFrameAssetId: 12,
  referenceAssetIds: [13],
  settings: {
    model: { id: "v1", label: "V1" },
    resolution: { id: "720p", label: "720p" },
    aspectRatio: { id: "16:9", label: "16:9" },
    duration: 5,
    quantity: "1",
    refMode: { id: "firstlast", label: "首尾帧" },
  },
};

const imageModelCapability = {
  model_id: "m1",
  provider_id: "p",
  model_label: "M1",
  icon: null,
  supported_sizes: [{ id: "2k", label: "2K", api_value: "2k", width: 2048, height: 2048 }],
  supported_aspect_ratios: ["1:1"],
  supported_formats: ["png"],
  default_size: "2k",
  default_format: "png",
  default_aspect_ratio: "1:1",
  features: { reference_image: false, watermark: false, quantity_max: 4, sequential_image_generation: false, stream: false, tools: false },
};

describe("useCanvasGeneration.generate", () => {
  it("image：建 running 占位 + createProjectGenerationJob(model_id/size) + startJob；轮询 succeeded → 写 assetId/done", async () => {
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 777, cursor: 0 });
    const { result, addNode, patchNode, patchNodeAndSave, addAsset } = renderGen();

    await act(async () => {
      await result.current.generate("画一只猫", imageArgs);
    });

    // 建占位节点时即冻结 recipe，running / 刷新窗口期也能恢复生成参数。
    expect(addNode).toHaveBeenCalledWith(
      "image",
      expect.objectContaining({
        data: expect.objectContaining({
          content: "画一只猫",
          status: "running",
          recipe: expect.objectContaining({ origin: "generated", generation: expect.objectContaining({ mediaKind: "image", model: "m1" }) }),
        }),
      }),
    );
    // createProjectGenerationJob 入参（projectId Number 化 + Node snake_case payload：model_id/size/aspect_ratio）
    expect(generation.createProjectGenerationJob).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: "image",
        input_asset_ids: [9],
        expected_output_count: 1,
        parameters: expect.objectContaining({ prompt: "画一只猫", model_id: "m1", size: "2k", aspect_ratio: "1:1", web_search: false, sequential_image_generation: false }),
      }),
      expect.any(String),
    );
    // startJob 触发（useVideoJobs.start 被 startJob 调，generation_job_id 闭包注入）
    expect(mockJobs.start).toHaveBeenCalledWith(777, expect.objectContaining({ onSucceeded: expect.any(Function), onFailed: expect.any(Function) }));
    expect(patchNodeAndSave).toHaveBeenCalledWith("n_ph", { taskId: "777" });
    // generating 复位（转后台轮询，不阻塞并发生成）
    expect(result.current.generating).toBe(false);

    // 手动触发轮询 succeeded 回调 → 注册 asset（assetId 全链路 String）+ patchNode 写 assetId/done + recipe
    const cb = mockJobs.start.mock.calls[0][1] as { onSucceeded: (r: { assetId: string; assetUrl: string; assetType: string }) => void };
    await act(async () => {
      cb.onSucceeded({
        assetId: "42",
        assetUrl:
          "https://bluewhale-assets.tos-cn-beijing.volces.com/generated/9/image/result.png",
        assetType: "image",
      });
    });
    expect(addAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "42",
        kind: "image",
        src: "https://bluewhale-assets.tos-cn-beijing.volces.com/generated/9/image/result.png",
        source: "generated",
      }),
    );
    expect(patchNode).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ assetId: "42", status: "done" }));
    const recipeCall = patchNode.mock.calls.find((c) => (c[1] as { recipe?: unknown }).recipe);
    expect(recipeCall?.[1]).toMatchObject({ recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } } });
  });

  it("video：createProjectGenerationJob + 建占位带 recipe/progress/taskId + startJob 后台轮询", async () => {
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 888, cursor: 0 });
    const { result, addNode, patchNodeAndSave } = renderGen();
    await act(async () => {
      await result.current.generate("做个视频", videoArgs);
    });
    expect(generation.createProjectGenerationJob).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        type: "video",
        input_asset_ids: [11],
        parameters: expect.objectContaining({ prompt: "做个视频", model_id: "v1", aspect_ratio: "16:9", resolution: "720p", duration: 5 }),
      }),
      expect.any(String),
    );
    // 建占位（running + progress 0 + recipe）
    const vCall = addNode.mock.calls.find((c) => c[0] === "video");
    expect(vCall?.[1]).toMatchObject({ data: expect.objectContaining({ content: "做个视频", status: "running", progress: 0 }) });
    expect((vCall?.[1] as { data: { recipe?: unknown } }).data.recipe).toMatchObject({ origin: "generated", generation: { mediaKind: "video", model: "v1" } });
    // startJob 触发（jobId 闭包注入）
    expect(mockJobs.start).toHaveBeenCalledWith(888, expect.objectContaining({ onSucceeded: expect.any(Function), onFailed: expect.any(Function) }));
    expect(patchNodeAndSave).toHaveBeenCalledWith("n_ph", { taskId: "888" });
    expect(result.current.generating).toBe(false);
  });

  it("video：任务接纳后公开 processing 状态并可请求取消", async () => {
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 888, cursor: 0 });
    (generation.cancelProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { result } = renderGen({ projectId: "55" });

    await act(async () => {
      await result.current.generate("做个视频", videoArgs);
    });
    expect(result.current.videoJobStatus).toBe("processing");

    await act(async () => {
      await result.current.cancelVideoJob();
    });

    expect(generation.cancelProjectGenerationJob).toHaveBeenCalledWith(55, 888);
    expect(result.current.videoJobStatus).toBe("cancel_requested");
    expect(result.current.cancellingVideo).toBe(false);
  });

  it("video：首帧、尾帧和普通参考素材分别进入 job payload", async () => {
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 889, cursor: 0 });
    const { result } = renderGen();

    await act(async () => {
      await result.current.generate("首尾帧视频", videoFrameArgs);
    });

    expect(generation.createProjectGenerationJob).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        input_asset_ids: [11, 12, 13],
        first_frame_asset_id: 11,
        last_frame_asset_id: 12,
        reference_asset_ids: [13],
      }),
      expect.any(String),
    );
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
    expect(generation.createProjectGenerationJob).not.toHaveBeenCalled();
  });

  it("image：取上游 text prompt → getImageModels + createProjectGenerationJob + startJob", async () => {
    (generation.getImageModels as ReturnType<typeof vi.fn>).mockResolvedValue([imageModelCapability]);
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 321, cursor: 0 });
    const t1 = { id: "t1", type: "text", position: { x: 0, y: 0 }, data: { kind: "text", prompt: "画猫" } } as unknown as CanvasNode;
    const img1 = { id: "img1", type: "image", position: { x: 0, y: 0 }, data: { kind: "image" } } as unknown as CanvasNode;
    const e1 = { id: "e1", source: "t1", target: "img1", targetHandle: "prompt" } as CanvasEdge;
    const { result, patchNode, patchNodeAndSave } = renderGen({ nodes: [t1, img1], edges: [e1] });
    await act(async () => {
      await result.current.generateFromNode("img1");
    });
    expect(generation.getImageModels).toHaveBeenCalled();
    expect(generation.createProjectGenerationJob).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "image", parameters: expect.objectContaining({ prompt: "画猫", model_id: "m1", size: "2k", aspect_ratio: "1:1" }) }),
      expect.any(String),
    );
    expect(mockJobs.start).toHaveBeenCalledWith(321, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    // recipe 创建即写节点（image：status running + recipe）
    const recipeCall = patchNode.mock.calls.find((c) => (c[1] as { recipe?: unknown }).recipe);
    expect(recipeCall?.[1]).toMatchObject({ recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } } });
    expect(patchNodeAndSave).toHaveBeenCalledWith("img1", { taskId: "321" });
    expect(result.current.generating).toBe(false);
  });

  it("video：取上游 prompt → getVideoModels + createProjectGenerationJob + 写 taskId + startJob", async () => {
    (generation.getVideoModels as ReturnType<typeof vi.fn>).mockResolvedValue([imageModelCapability]);
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 999, cursor: 0 });
    const t1 = { id: "t1", type: "text", position: { x: 0, y: 0 }, data: { kind: "text", prompt: "做视频" } } as unknown as CanvasNode;
    const vid = { id: "vid1", type: "video", position: { x: 0, y: 0 }, data: { kind: "video" } } as unknown as CanvasNode;
    const e1 = { id: "e1", source: "t1", target: "vid1", targetHandle: "prompt" } as CanvasEdge;
    const { result, patchNode, patchNodeAndSave } = renderGen({ nodes: [t1, vid], edges: [e1] });
    await act(async () => {
      await result.current.generateFromNode("vid1");
    });
    expect(generation.getVideoModels).toHaveBeenCalled();
    expect(generation.createProjectGenerationJob).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: "video", parameters: expect.objectContaining({ prompt: "做视频" }) }),
      expect.any(String),
    );
    // 写 taskId 关联 job（刷新 recover by taskId）
    expect(patchNodeAndSave).toHaveBeenCalledWith("vid1", { taskId: "999" });
    expect(mockJobs.start).toHaveBeenCalledWith(999, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(result.current.generating).toBe(false);
  });
});

describe("useCanvasGeneration.recover", () => {
  it("existing 节点 taskId 匹配 job → 恢复 status=running + 续轮询（不建重复）", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { job_id: "130", type: "video", status: "processing", progress: 30, input: { parameters: { prompt: "猫" } }, created_at: "", output_assets: [] },
    ]);
    const existing = { id: "n_vid", type: "video", position: { x: 0, y: 0 }, width: 356, height: 200, data: { kind: "video", taskId: "130", content: "猫" } } as unknown as CanvasNode;
    const { result, patchNode, addNode } = renderGen({ nodes: [existing] });
    await act(async () => {
      await result.current.recover([existing]);
    });
    // 恢复 running + 续轮询
    expect(patchNode).toHaveBeenCalledWith("n_vid", expect.objectContaining({ status: "running", progress: 0 }));
    expect(mockJobs.start).toHaveBeenCalledWith(130, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(addNode).not.toHaveBeenCalled(); // byTaskId 匹配 → 不建重复占位
  });

  it("刷新发现 failed job → 收敛为 error 且不重新启动轮询", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockImplementation(
      ({ status }: { status: string }) =>
        Promise.resolve(
          status === "failed"
            ? [{ job_id: "131", type: "video", status: "failed", progress: 0, input: {}, created_at: "", output_assets: [] }]
            : [],
        ),
    );
    const existing = { id: "n_failed", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "131" } } as unknown as CanvasNode;
    const { result, patchNode } = renderGen({ nodes: [existing] });

    await act(async () => {
      await result.current.recover([existing]);
    });

    expect(generation.listJobs).toHaveBeenCalledWith({ projectId: 1, status: "failed", size: 50 });
    expect(patchNode).toHaveBeenCalledWith("n_failed", {
      status: "error",
      errorMessage: "生成失败",
    });
    expect(mockJobs.start).not.toHaveBeenCalled();
  });

  it("无 taskId 候选 → recover 提前返回（不查 listJobs、不建占位）", async () => {
    const { result, addNode } = renderGen({ nodes: [] });
    await act(async () => {
      await result.current.recover([]);
    });
    expect(generation.listJobs).not.toHaveBeenCalled();
    expect(addNode).not.toHaveBeenCalled();
  });
});

describe("useCanvasGeneration.reconcile", () => {
  it("succeeded job + 节点有 taskId 无 assetId → 写 assetId/done（防永卡）", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { job_id: "130", type: "video", status: "succeeded", progress: 100, input: {}, created_at: "", output_assets: [{ id: "555", url: "v555.mp4", type: "video", width: null, height: null }] },
    ]);
    const stuck = { id: "n_vid", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "130" } } as unknown as CanvasNode;
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
  it("同批两个图片任务和两个视频任务按各自 taskId 独立恢复", async () => {
    const nodes = [
      { id: "img_active", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", taskId: "701" } } as CanvasNode,
      { id: "img_done", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", taskId: "702" } } as CanvasNode,
      { id: "video_active", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "703" } } as CanvasNode,
      { id: "video_done", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "704" } } as CanvasNode,
    ];
    (generation.listJobs as ReturnType<typeof vi.fn>).mockImplementation(
      ({ status }: { status: string }) => {
        if (status === "queued") {
          return Promise.resolve([
            { job_id: "701", type: "image", status, progress: 0, input: {}, created_at: "", output_assets: [] },
          ]);
        }
        if (status === "processing") {
          return Promise.resolve([
            { job_id: "703", type: "video", status, progress: 40, input: {}, created_at: "", output_assets: [] },
          ]);
        }
        if (status === "succeeded") {
          return Promise.resolve([
            { job_id: "702", type: "image", status, progress: 100, input: {}, created_at: "", output_assets: [{ id: "802", url: "image-802.png", type: "image", width: null, height: null }] },
            { job_id: "704", type: "video", status, progress: 100, input: {}, created_at: "", output_assets: [{ id: "804", url: "video-804.mp4", type: "video", width: null, height: null }] },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    const { result, patchNode, addAsset } = renderGen({ nodes });

    await act(async () => {
      await result.current.hydrate(nodes);
    });

    expect(patchNode).toHaveBeenCalledWith("img_active", { status: "running", progress: 0 });
    expect(patchNode).toHaveBeenCalledWith("video_active", { status: "running", progress: 0 });
    expect(mockJobs.start).toHaveBeenCalledWith(701, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(mockJobs.start).toHaveBeenCalledWith(703, expect.objectContaining({ onSucceeded: expect.any(Function) }));
    expect(patchNode).toHaveBeenCalledWith("img_done", expect.objectContaining({ assetId: "802", status: "done" }));
    expect(patchNode).toHaveBeenCalledWith("video_done", expect.objectContaining({ assetId: "804", status: "done" }));
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "802", kind: "image", src: "image-802.png" }));
    expect(addAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "804", kind: "video", src: "video-804.mp4" }));
  });

  it("refresh batch-hydrates uploaded canvas assets from one project snapshot without per-node GETs", async () => {
    mockLoadSnapshot.mockResolvedValueOnce({
      assets: {
        "200": {
          asset_id: "200",
          type: "image",
          access_url:
            "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/9/image/first.png",
        },
        "201": {
          asset_id: "201",
          type: "image",
          access_url:
            "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/9/image/second.png",
        },
      },
    });
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const nodes = [
      { id: "n_lf9g6vq8", type: "image", position: { x: 242, y: 53 }, data: { kind: "image", assetId: "200", recipe: { origin: "uploaded" } } } as CanvasNode,
      { id: "n_rupfkali", type: "image", position: { x: 448, y: 224 }, data: { kind: "image", assetId: "201", recipe: { origin: "uploaded" } } } as CanvasNode,
    ];
    const { result, addAsset } = renderGen({ nodes, projectId: "55" });

    await act(async () => {
      await result.current.hydrate(nodes);
    });

    expect(mockLoadSnapshot).toHaveBeenCalledTimes(1);
    expect(mockLoadSnapshot).toHaveBeenCalledWith(55, expect.any(AbortSignal));
    expect(addAsset).toHaveBeenCalledWith({
      id: "200",
      kind: "image",
      src: "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/9/image/first.png",
    });
    expect(addAsset).toHaveBeenCalledWith({
      id: "201",
      kind: "image",
      src: "https://bluewhale-assets.tos-cn-beijing.volces.com/uploads/9/image/second.png",
    });
  });

  it("图片节点 serialize/parse 后 hydrate 恢复 processing 状态并续轮询", async () => {
    (generation.createProjectGenerationJob as ReturnType<typeof vi.fn>).mockResolvedValue({ generation_job_id: 777, cursor: 0 });
    const generated = renderGen();

    await act(async () => {
      await generated.result.current.generate("画一只猫", imageArgs);
    });

    const extra = generated.addNode.mock.calls[0][1] as { width: number; height: number; data: CanvasNode["data"] };
    let persistedNode = {
      id: "n_ph",
      type: "image",
      position: { x: 0, y: 0 },
      width: extra.width,
      height: extra.height,
      data: { ...extra.data },
    } as CanvasNode;
    for (const [nodeId, patch] of generated.patchNode.mock.calls as Array<[string, Partial<CanvasNode["data"]>]>) {
      if (nodeId === persistedNode.id) persistedNode = { ...persistedNode, data: { ...persistedNode.data, ...patch } };
    }
    for (const [nodeId, patch] of generated.patchNodeAndSave.mock.calls as Array<[string, Partial<CanvasNode["data"]>]>) {
      if (nodeId === persistedNode.id) persistedNode = { ...persistedNode, data: { ...persistedNode.data, ...patch } };
    }

    const loadedNode = parse(serialize({ id: "", nodes: [persistedNode], edges: [], version: 1 })).nodes[0];
    expect(loadedNode.data).toMatchObject({
      taskId: "777",
      recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } },
    });
    expect(loadedNode.data.status).toBeUndefined();

    mockJobs.start.mockClear();
    (generation.listJobs as ReturnType<typeof vi.fn>).mockImplementation(({ status }: { status: string }) =>
      Promise.resolve(
        status === "processing"
          ? [{ job_id: "777", type: "image", status: "processing", progress: 20, input: {}, created_at: "", output_assets: [] }]
          : [],
      ),
    );
    const refreshed = renderGen({ nodes: [loadedNode] });

    await act(async () => {
      await refreshed.result.current.hydrate([loadedNode]);
    });

    expect(refreshed.patchNode).toHaveBeenCalledWith("n_ph", { status: "running", progress: 0 });
    expect(mockJobs.start).toHaveBeenCalledWith(777, expect.objectContaining({ onSucceeded: expect.any(Function) }));

    const callbacks = mockJobs.start.mock.calls[0][1] as { onSucceeded: (result: { assetId: string; assetUrl: string; assetType: string }) => void };
    await act(async () => {
      callbacks.onSucceeded({ assetId: "42", assetUrl: "u.png", assetType: "image" });
    });
    const donePatch = refreshed.patchNode.mock.calls.find(([, patch]) => (patch as CanvasNode["data"]).status === "done")?.[1] as
      | Partial<CanvasNode["data"]>
      | undefined;
    expect({ ...loadedNode.data, ...donePatch }).toMatchObject({
      assetId: "42",
      status: "done",
      recipe: { origin: "generated", generation: { mediaKind: "image", model: "m1" } },
    });
  });

  it("视频节点刷新时 job 仍 queued，也恢复 loading 并续轮询", async () => {
    const loadedNode = parse(
      serialize({
        id: "",
        nodes: [
          {
            id: "n_video",
            type: "video",
            position: { x: 0, y: 0 },
            width: 356,
            height: 200,
            data: {
              kind: "video",
              taskId: "888",
              recipe: {
                origin: "generated",
                generation: { mediaKind: "video", model: "v1" },
              },
            },
          } as CanvasNode,
        ],
        edges: [],
        version: 1,
      }),
    ).nodes[0];
    (generation.listJobs as ReturnType<typeof vi.fn>).mockImplementation(
      ({ status }: { status: string }) =>
        Promise.resolve(
          status === "queued"
            ? [
                {
                  job_id: "888",
                  type: "video",
                  status: "queued",
                  progress: 0,
                  input: {},
                  created_at: "",
                  output_assets: [],
                },
              ]
            : [],
        ),
    );
    const refreshed = renderGen({ nodes: [loadedNode] });

    await act(async () => {
      await refreshed.result.current.hydrate([loadedNode]);
    });

    expect(refreshed.patchNode).toHaveBeenCalledWith("n_video", {
      status: "running",
      progress: 0,
    });
    expect(mockJobs.start).toHaveBeenCalledWith(
      888,
      expect.objectContaining({ onSucceeded: expect.any(Function) }),
    );
  });

  it("load 后统一水合：snapshot assets + recover(processing) + reconcile(succeeded)", async () => {
    (generation.listJobs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const nodes = [
      { id: "n1", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", assetId: "95" } } as unknown as CanvasNode,
      { id: "n2", type: "image", position: { x: 0, y: 0 }, data: { kind: "image" } } as unknown as CanvasNode, // 无 assetId（ensureAsset 跳过）
      { id: "n3", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", taskId: "200" } } as unknown as CanvasNode, // reconcile 候选（taskId 无 assetId）
    ];
    const { result } = renderGen({ nodes });
    await act(async () => {
      await result.current.hydrate(nodes);
    });
    expect(mockLoadSnapshot).toHaveBeenCalledTimes(1);
    // recover(queued + processing + failed) + reconcile(succeeded)
    expect(generation.listJobs).toHaveBeenCalledTimes(4);
  });
});
