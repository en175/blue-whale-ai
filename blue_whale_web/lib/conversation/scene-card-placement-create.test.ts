import { describe, expect, it, vi } from "vitest";

import type { CanvasRepo, CanvasView } from "@blue-whale/persistence";

import { placeSceneCardNode } from "./scene-card-placement.js";

describe("placeSceneCardNode", () => {
  it("写入规范化场景卡节点线格式", async () => {
    const savedNodes: unknown[][] = [];
    const canvas = {
      getByProject: vi.fn(async () => ({
        id: "1",
        project_id: "42",
        version: 3,
        viewport: null,
        nodes: "[]",
      })),
      save: vi.fn(),
      saveIfVersion: vi.fn(
        async (
          _projectId: string,
          _expectedVersion: number | null,
          _viewport: string | null,
          nextNodes: string | null,
        ) => {
          savedNodes.push(JSON.parse(nextNodes ?? "[]") as unknown[]);
          return {
            id: "1",
            project_id: "42",
            version: 4,
            viewport: null,
            nodes: nextNodes,
          };
        },
      ),
    } as unknown as CanvasRepo;

    await placeSceneCardNode(canvas, "42", "66");

    expect(savedNodes[0]?.[0]).toMatchObject({
      id: "scene-card:66",
      type: "scene-card",
      width: 400,
      height: 1080,
      zIndex: 0,
      data: { sceneCardId: "66" },
    });
  });

  it("CAS 冲突后重读并保留并发新增节点", async () => {
    let version = 1;
    let nodes: unknown[] = [{ id: "existing", position: { x: 0, y: 0 } }];
    const view = (): CanvasView => ({
      id: "1",
      project_id: "42",
      version,
      viewport: null,
      nodes: JSON.stringify(nodes),
    });
    const canvas = {
      getByProject: vi.fn(async () => view()),
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
            nodes = [
              ...nodes,
              { id: "concurrent", position: { x: 500, y: 0 } },
            ];
            return null;
          }
          if (expectedVersion !== version) return null;
          version += 1;
          nodes = nextNodes ? (JSON.parse(nextNodes) as unknown[]) : [];
          return view();
        },
      ),
    } as unknown as CanvasRepo;

    await placeSceneCardNode(canvas, "42", "66");

    expect(canvas.save).not.toHaveBeenCalled();
    expect(canvas.saveIfVersion).toHaveBeenCalledTimes(2);
    expect((nodes as Array<{ id: string }>).map((node) => node.id)).toEqual(
      expect.arrayContaining(["existing", "concurrent", "scene-card:66"]),
    );
  });
});
