import { describe, expect, it, vi } from "vitest";

import {
  placeSceneCardNode,
  recoverPendingPlacements,
} from "./scene-card-placement.js";
import type { CanvasRepo, CanvasView } from "@blue-whale/persistence";

function makeCanvas(
  initialNodes: unknown[],
  viewport: unknown = null,
): {
  canvas: CanvasRepo & { _nodes: unknown[]; _saveCalls: number };
} {
  let nodes = initialNodes;
  let saveCalls = 0;
  let version = 0;
  const canvas = {
    _nodes: nodes,
    _saveCalls: 0,
    async getByProject(): Promise<CanvasView> {
      return {
        id: "1",
        project_id: "42",
        version,
        viewport: viewport ? JSON.stringify(viewport) : null,
        nodes: JSON.stringify(nodes),
      };
    },
    async save(
      _projectId: string,
      _viewport: string | null,
      nextNodes: string | null,
    ): Promise<CanvasView> {
      saveCalls += 1;
      version += 1;
      nodes = nextNodes ? (JSON.parse(nextNodes) as unknown[]) : [];
      return {
        id: "1",
        project_id: "42",
        version,
        viewport: _viewport,
        nodes: nextNodes,
      };
    },
    async saveIfVersion(
      projectId: string,
      expectedVersion: number | null,
      nextViewport: string | null,
      nextNodes: string | null,
    ): Promise<CanvasView | null> {
      if (expectedVersion !== version) return null;
      saveCalls += 1;
      version += 1;
      nodes = nextNodes ? (JSON.parse(nextNodes) as unknown[]) : [];
      return {
        id: "1",
        project_id: projectId,
        version,
        viewport: nextViewport,
        nodes: nextNodes,
      };
    },
  } as unknown as CanvasRepo & { _nodes: unknown[]; _saveCalls: number };
  // 暴露内部计数（测试断言用）。
  Object.defineProperty(canvas, "_saveCalls", { get: () => saveCalls });
  Object.defineProperty(canvas, "_nodes", { get: () => nodes });
  return { canvas };
}

describe("recoverPendingPlacements（IK67HE/T14 放置恢复幂等）", () => {
  it("从成功但待放置的输出槽重建缺失图片节点", async () => {
    const { canvas } = makeCanvas([]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 2,
          asset_id: "901",
          type: "image",
          scene_card_id: null,
          placement_anchor: { x: 10, y: 20 },
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recoverPendingPlacements(
      canvas,
      "42",
      placements as never,
    );

    expect(result.placed).toEqual(["generation-output:501"]);
    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        assetId: "901",
        width: 200,
        height: 112,
      }),
    );
    expect(placements.markPlaced).toHaveBeenCalledWith("501");
  });

  it("CAS 冲突后重读并保留并发新增节点", async () => {
    let version = 1;
    let nodes: unknown[] = [{ id: "existing", status: "placed" }];
    const canvas = {
      getByProject: vi.fn(async () => ({
        id: "1",
        project_id: "42",
        version,
        viewport: null,
        nodes: JSON.stringify(nodes),
      })),
      save: vi.fn(),
      saveIfVersion: vi.fn(
        async (
          _projectId: string,
          expectedVersion: number | null,
          _viewport: string | null,
          nextNodes: string | null,
        ) => {
          if (version === 1) {
            version = 2;
            nodes = [...nodes, { id: "concurrent", status: "placed" }];
            return null;
          }
          if (expectedVersion !== version) return null;
          version += 1;
          nodes = nextNodes ? (JSON.parse(nextNodes) as unknown[]) : [];
          return {
            id: "1",
            project_id: "42",
            version,
            viewport: null,
            nodes: nextNodes,
          };
        },
      ),
    } as unknown as CanvasRepo;
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "image",
          scene_card_id: null,
          placement_anchor: null,
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    expect((nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "existing",
        "concurrent",
        "generation-output:501",
      ]),
    );
    expect(canvas.saveIfVersion).toHaveBeenCalledTimes(2);
    expect(placements.markPlaced).toHaveBeenCalledTimes(1);
  });

  it("再次生成使用成功槽身份创建独立视频节点并保留 Canvas 字段契约", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 100, y: 200 },
        width: 400,
        height: 320,
        status: "placed",
      },
      {
        id: "generation-output:401",
        type: "video",
        sceneCardId: "66",
        position: { x: 100, y: 530 },
        width: 400,
        height: 225,
        assetId: "801",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "video",
          scene_card_id: "66",
          placement_anchor: { x: 100, y: 200, width: 400, height: 320 },
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recoverPendingPlacements(canvas, "42", placements);

    expect(result.placed).toContain("generation-output:501");
    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        type: "video",
        assetId: "901",
        sceneCardId: "66",
        width: 400,
        height: 225,
      }),
    );
  });

  it("旧的无尺寸 SceneCard 仍按兼容高度把视频放在卡片下方", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 100, y: 200 },
        status: "placed",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "video",
          scene_card_id: "66",
          placement_anchor: null,
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        position: { x: 100, y: 1290 },
      }),
    );
  });

  it("图片产物优先跟随 SceneCard 当前坐标而非旧冻结锚点", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 500, y: 600 },
        width: 400,
        height: 300,
        status: "placed",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "image",
          scene_card_id: "66",
          placement_anchor: { x: 10, y: 20, width: 400, height: 100 },
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        position: { x: 500, y: 910 },
      }),
    );
  });

  it("分镜画格复用图片节点并按槽位从左到右稳定排列", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 100, y: 200 },
        width: 400,
        height: 300,
        status: "placed",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue(
        Array.from({ length: 4 }, (_, slotIndex) => ({
          slot_id: String(501 + slotIndex),
          generation_job_id: "301",
          slot_index: slotIndex,
          asset_id: String(901 + slotIndex),
          type: "image",
          is_storyboard_frame: true,
          scene_card_id: "66",
          placement_anchor: null,
        })),
      ),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements as never);

    const frames = (
      canvas._nodes as Array<{
        id: string;
        type: string;
        storyboardFrame?: boolean;
        slotIndex: number;
        position: { x: number; y: number };
      }>
    )
      .filter((node) => node.id.startsWith("storyboard-frame:"))
      .sort((left, right) => left.slotIndex - right.slotIndex);
    expect(frames).toEqual([
      expect.objectContaining({
        id: "storyboard-frame:501",
        type: "image",
        storyboardFrame: true,
        position: { x: 100, y: 510 },
      }),
      expect.objectContaining({
        id: "storyboard-frame:502",
        type: "image",
        storyboardFrame: true,
        position: { x: 310, y: 510 },
      }),
      expect.objectContaining({
        id: "storyboard-frame:503",
        type: "image",
        storyboardFrame: true,
        position: { x: 520, y: 510 },
      }),
      expect.objectContaining({
        id: "storyboard-frame:504",
        type: "image",
        storyboardFrame: true,
        position: { x: 730, y: 510 },
      }),
    ]);
  });

  it("SceneCard 缺失时从冻结矩形的精确下方开始放置", async () => {
    const { canvas } = makeCanvas([]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "video",
          scene_card_id: "66",
          placement_anchor: { x: 100, y: 200, width: 400, height: 300 },
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        position: { x: 100, y: 510 },
      }),
    );
  });

  it("混合图片视频按兄弟节点真实底边继续纵向下排", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 100, y: 200 },
        width: 400,
        height: 300,
        status: "placed",
      },
      {
        id: "generation-output:401",
        type: "video",
        sceneCardId: "66",
        position: { x: 100, y: 510 },
        width: 400,
        height: 225,
        status: "placed",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "image",
          scene_card_id: "66",
          placement_anchor: null,
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "generation-output:501",
        position: { x: 100, y: 745 },
      }),
    );
  });

  it("搜索空间耗尽时保持输出槽 pending，不写入重叠节点", async () => {
    const { canvas } = makeCanvas([
      {
        id: "blocker",
        type: "image",
        position: { x: -1000, y: -1000 },
        width: 10000,
        height: 10000,
        status: "placed",
      },
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "image",
          scene_card_id: null,
          placement_anchor: null,
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    const result = await recoverPendingPlacements(canvas, "42", placements);

    expect(result.placed).toEqual([]);
    expect(result.still_pending).toEqual(["generation-output:501"]);
    expect(canvas._saveCalls).toBe(0);
    expect(placements.markPlaced).not.toHaveBeenCalled();
  });

  it("SceneCard 下方被占用时为视频输出寻找无碰撞位置", async () => {
    const blocker = {
      id: "blocker",
      type: "image",
      position: { x: 100, y: 345 },
      width: 400,
      height: 225,
      status: "placed",
    };
    const { canvas } = makeCanvas([
      {
        id: "scene-card:66",
        type: "scene_card",
        scene_card_id: "66",
        position: { x: 100, y: 200 },
        width: 240,
        height: 135,
        status: "placed",
      },
      blocker,
    ]);
    const placements = {
      listPending: vi.fn().mockResolvedValue([
        {
          slot_id: "501",
          generation_job_id: "301",
          slot_index: 0,
          asset_id: "901",
          type: "video",
          scene_card_id: "66",
          placement_anchor: { x: 100, y: 200, width: 240, height: 135 },
        },
      ]),
      markPlaced: vi.fn().mockResolvedValue(undefined),
    };

    await recoverPendingPlacements(canvas, "42", placements);

    const output = (
      canvas._nodes as Array<{
        id: string;
        position: { x: number; y: number };
        width: number;
        height: number;
      }>
    ).find((node) => node.id === "generation-output:501");
    expect(output).toBeDefined();
    expect(
      output!.position.x < blocker.position.x + blocker.width &&
        output!.position.x + output!.width > blocker.position.x &&
        output!.position.y < blocker.position.y + blocker.height &&
        output!.position.y + output!.height > blocker.position.y,
    ).toBe(false);
  });

  it("把 pending 节点落位为 placed，不移动既有 placed 节点", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene_card_1",
        type: "scene_card",
        scene_card_id: "1",
        position: { x: 0, y: 0 },
        width: 240,
        height: 135,
        status: "placed",
      },
      {
        id: "scene_card_2",
        type: "scene_card",
        scene_card_id: "2",
        position: { x: 0, y: 0 },
        width: 240,
        height: 135,
        status: "pending",
      },
    ]);
    const result = await recoverPendingPlacements(canvas, "42");
    expect(result.placed).toContain("scene_card_2");
    expect(result.still_pending).toEqual([]);
    // 已 placed 的节点位置不变。
    const saved = canvas._nodes as Array<{
      id: string;
      status: string;
      position: { x: number };
    }>;
    const node1 = saved.find((n) => n.id === "scene_card_1");
    expect(node1?.position.x).toBe(0);
    expect(node1?.status).toBe("placed");
    const node2 = saved.find((n) => n.id === "scene_card_2");
    expect(node2?.status).toBe("placed");
  });

  it("恢复无尺寸 pending SceneCard 时补齐兼容矩形", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene_card_1",
        type: "scene_card",
        scene_card_id: "1",
        status: "pending",
      },
    ]);

    await recoverPendingPlacements(canvas, "42");

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        id: "scene_card_1",
        position: { x: -424, y: -1104 },
        width: 400,
        height: 1080,
        status: "placed",
      }),
    );
  });

  it("无 pending 节点时不触发 save（幂等空操作）", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene_card_1",
        type: "scene_card",
        position: { x: 0, y: 0 },
        width: 240,
        height: 135,
        status: "placed",
      },
    ]);
    const result = await recoverPendingPlacements(canvas, "42");
    expect(result.placed).toEqual([]);
    expect(canvas._saveCalls).toBe(0);
  });

  it("空 Canvas 不报错且不 save", async () => {
    const { canvas } = makeCanvas([]);
    const result = await recoverPendingPlacements(canvas, "42");
    expect(result.placed).toEqual([]);
    expect(result.still_pending).toEqual([]);
    expect(canvas._saveCalls).toBe(0);
  });
});

describe("placeSceneCardNode（既有幂等行为）", () => {
  it("新建节点使用 Spec 宽度与兼容高度", async () => {
    const { canvas } = makeCanvas([]);

    await placeSceneCardNode(canvas, "42", "5");

    expect(canvas._nodes).toContainEqual(
      expect.objectContaining({
        scene_card_id: "5",
        width: 400,
        height: 1080,
      }),
    );
  });

  it("同一 SceneCard 已有节点时直接返回不重复创建", async () => {
    const { canvas } = makeCanvas([
      {
        id: "scene_card_5",
        type: "scene_card",
        scene_card_id: "5",
        position: { x: 0, y: 0 },
        width: 240,
        height: 135,
        status: "placed",
      },
    ]);
    await placeSceneCardNode(canvas, "42", "5");
    expect(canvas._saveCalls).toBe(0);
  });
});
