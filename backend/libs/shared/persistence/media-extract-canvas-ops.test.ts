import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  failMediaExtractNode,
  placeMediaExtractPendingNode,
  updateMediaExtractNodeToAudio,
} from "./media-extract-canvas-ops.js";

const VIDEO_NODE = {
  id: "media-video-1",
  type: "mediaNode",
  position: { x: 100, y: 50 },
  data: { src: "https://b.test/v.mp4", fileName: "测试视频.mp4", mediaType: "video", assetId: "3985" },
};

function makeCanvasPrisma(overrides: { nodes?: unknown[]; updateCount?: number[] } = {}) {
  const { nodes = [VIDEO_NODE], updateCount = [1] } = overrides;
  const findFirst = vi.fn().mockResolvedValue({
    id: 5n,
    project_id: 197n,
    version: 3,
    nodes_json: nodes,
  });
  const updateMany = vi
    .fn()
    .mockResolvedValueOnce({ count: updateCount[0] })
    .mockImplementation(() => ({ count: 1 }));
  return { findFirst, updateMany };
}

describe("media-extract canvas ops", () => {
  it("placeMediaExtractPendingNode inserts a pending audio node right of the video node", async () => {
    const { findFirst, updateMany } = makeCanvasPrisma();
    const prisma = { canvas: { findFirst, updateMany } } as never;
    const result = await placeMediaExtractPendingNode(prisma, {
      projectId: "197",
      jobId: "400",
      sourceAssetId: "3985",
    });
    expect(result).toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5n, version: 3 } }),
    );
    const data = updateMany.mock.calls[0][0].data;
    const node = data.nodes_json.find((n: any) => n.id === "media-extract-400");
    expect(node.position).toEqual({ x: 440, y: 50 }); // 视频 x=100 + 340 → 右侧
    expect(node.data).toMatchObject({
      mediaType: "audio",
      genStatus: "generating",
      jobId: "400",
      fileName: "测试视频(audio).mp3",
    });
  });

  it("placeMediaExtractPendingNode is idempotent for the same job", async () => {
    const { findFirst, updateMany } = makeCanvasPrisma({
      nodes: [
        VIDEO_NODE,
        { id: "media-extract-400", type: "mediaNode", position: { x: 440, y: 50 }, data: {} },
      ],
    });
    const prisma = { canvas: { findFirst, updateMany } } as never;
    const result = await placeMediaExtractPendingNode(prisma, {
      projectId: "197",
      jobId: "400",
      sourceAssetId: "3985",
    });
    expect(result).toBe(true);
    // 已存在同 job 节点 → 视为成功但不再 push（updateMany 数据不含新增第二个）
    const data = updateMany.mock.calls[0][0].data;
    expect(data.nodes_json.filter((n: any) => n.id.startsWith("media-extract-")).length).toBe(1);
  });

  it("placeMediaExtractPendingNode returns false when video node not found", async () => {
    const { findFirst, updateMany } = makeCanvasPrisma({ nodes: [] });
    const prisma = { canvas: { findFirst, updateMany } } as never;
    const result = await placeMediaExtractPendingNode(prisma, {
      projectId: "197",
      jobId: "400",
      sourceAssetId: "999",
    });
    expect(result).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("retries on version conflict (CAS count 0 then 1)", async () => {
    const { findFirst, updateMany } = makeCanvasPrisma({ updateCount: [0] });
    // 重试时 findFirst 第二次返回 version 递增后的画布
    findFirst
      .mockResolvedValueOnce({
        id: 5n,
        project_id: 197n,
        version: 3,
        nodes_json: [VIDEO_NODE],
      })
      .mockResolvedValue({
        id: 5n,
        project_id: 197n,
        version: 4,
        nodes_json: [
          VIDEO_NODE,
          { id: "media-extract-400", type: "mediaNode", position: { x: 440, y: 50 }, data: {} },
        ],
      });
    const prisma = { canvas: { findFirst, updateMany } } as never;
    const result = await placeMediaExtractPendingNode(prisma, {
      projectId: "197",
      jobId: "400",
      sourceAssetId: "3985",
    });
    expect(result).toBe(true);
    // 冲突后重试，最终写入成功
    expect(updateMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("updateMediaExtractNodeToAudio updates the node to final audio and preserves fileName", async () => {
    const pendingNode = {
      id: "media-extract-400",
      type: "mediaNode",
      position: { x: 440, y: 50 },
      data: { src: "", fileName: "测试视频(audio).mp3", mediaType: "audio", genStatus: "generating", progress: 0, jobId: "400" },
    };
    const { findFirst, updateMany } = makeCanvasPrisma({ nodes: [VIDEO_NODE, pendingNode] });
    const generation_jobs = {
      findUnique: vi.fn().mockResolvedValue({ output_asset_ids: [901n] }),
    };
    const prisma = { canvas: { findFirst, updateMany }, generation_jobs } as never;
    const result = await updateMediaExtractNodeToAudio(prisma, {
      jobId: "400",
      projectId: "197",
      url: "https://b.test/a.mp3",
      mime: "audio/mpeg",
      size: 1024,
      duration: 32.18,
    });
    expect(result).toBe(true);
    const data = updateMany.mock.calls[0][0].data;
    const node = data.nodes_json.find((n: any) => n.id === "media-extract-400");
    expect(node.data).toMatchObject({
      src: "https://b.test/a.mp3",
      mediaType: "audio",
      fileName: "测试视频(audio).mp3",
      assetId: "901",
      duration: 32.18,
      progress: 100,
    });
    expect(node.data.genStatus).toBeUndefined();
  });

  it("failMediaExtractNode marks the placeholder node failed", async () => {
    const pendingNode = {
      id: "media-extract-400",
      type: "mediaNode",
      position: { x: 440, y: 50 },
      data: { src: "", fileName: "测试视频(audio).mp3", mediaType: "audio", genStatus: "generating", progress: 0, jobId: "400" },
    };
    const { findFirst, updateMany } = makeCanvasPrisma({ nodes: [VIDEO_NODE, pendingNode] });
    const prisma = { canvas: { findFirst, updateMany } } as never;
    const result = await failMediaExtractNode(prisma, {
      jobId: "400",
      projectId: "197",
      code: "video_has_no_audio_track",
      message: "视频没有音轨",
    });
    expect(result).toBe(true);
    const data = updateMany.mock.calls[0][0].data;
    const node = data.nodes_json.find((n: any) => n.id === "media-extract-400");
    expect(node.data).toMatchObject({
      genStatus: "failed",
      errorText: "视频没有音轨",
    });
  });
});

describe("音频提取完成后的卡片名称", () => {
  it.each([true, false, undefined])("保留显式 customName=%s，不恢复生成态", async (customName) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findUnique: vi.fn().mockResolvedValue({ output_asset_ids: [6041] }) },
      canvas: {
        findFirst: vi.fn().mockResolvedValue({
          id: 1n, version: 2,
          nodes_json: [{ id: "media-extract-1834", data: {
            fileName: "我的配乐", genStatus: "generating", jobId: "1834",
            ...(customName === undefined ? {} : { customName }),
          } }],
        }),
        updateMany,
      },
    };

    expect(await updateMediaExtractNodeToAudio(prisma as unknown as PrismaClient, {
      jobId: "1834", projectId: "438", url: "https://tos/a.mp3",
      mime: "audio/mpeg", size: 124563, duration: 3.9,
    })).toBe(true);

    const data = updateMany.mock.calls[0]![0].data.nodes_json[0].data;
    expect(data).toMatchObject({ fileName: "我的配乐", src: "https://tos/a.mp3", assetId: "6041" });
    if (customName === undefined) expect(data).not.toHaveProperty("customName");
    else expect(data).toHaveProperty("customName", customName);
    expect(data).not.toHaveProperty("genStatus");
    expect(data).not.toHaveProperty("jobId");
  });
});
