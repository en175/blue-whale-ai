import {
  findPlacement,
  SCENE_CARD_FALLBACK_HEIGHT,
  SCENE_CARD_WIDTH,
  type Rect,
} from "@lib/core";
import type { Prisma } from "@prisma/client";

import type { CreateJobInput } from "./generation-command-repo.js";

function validAnchor(value: unknown): value is {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.x === "number" &&
    typeof anchor.y === "number" &&
    typeof anchor.width === "number" &&
    typeof anchor.height === "number"
  );
}

export async function freezePlacementAnchor(
  tx: Prisma.TransactionClient,
  input: CreateJobInput,
): Promise<Record<string, unknown>> {
  if (validAnchor(input.input.placement_anchor)) return input.input;
  const ports = tx as unknown as {
    canvas?: {
      findFirst(args: unknown): Promise<{
        viewport_json: unknown;
        nodes_json: unknown;
      } | null>;
    };
  };
  if (!ports.canvas?.findFirst) return input.input;

  const canvas = await ports.canvas.findFirst({
    where: { project_id: BigInt(input.projectId) },
    select: { viewport_json: true, nodes_json: true },
  });
  const viewport =
    canvas?.viewport_json &&
    typeof canvas.viewport_json === "object" &&
    !Array.isArray(canvas.viewport_json)
      ? (canvas.viewport_json as Record<string, unknown>)
      : {};
  const zoom =
    typeof viewport.zoom === "number" && viewport.zoom > 0 ? viewport.zoom : 1;
  let anchor = {
    x: -(typeof viewport.x === "number" ? viewport.x : 0) / zoom,
    y: -(typeof viewport.y === "number" ? viewport.y : 0) / zoom,
    width: 0,
    height: 0,
  };

  if (input.sceneCardId) {
    const nodes = Array.isArray(canvas?.nodes_json) ? canvas.nodes_json : [];
    const sceneCardNode = nodes.find((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        return false;
      }
      const candidate = node as Record<string, unknown>;
      const data =
        candidate.data &&
        typeof candidate.data === "object" &&
        !Array.isArray(candidate.data)
          ? (candidate.data as Record<string, unknown>)
          : {};
      return (
        candidate.type === "scene_card" &&
        String(candidate.scene_card_id ?? data.sceneCardId) ===
          input.sceneCardId
      );
    });
    let hasActualAnchor = false;
    if (sceneCardNode && typeof sceneCardNode === "object") {
      const node = sceneCardNode as Record<string, unknown>;
      const position = node.position;
      if (
        position &&
        typeof position === "object" &&
        !Array.isArray(position)
      ) {
        const point = position as Record<string, unknown>;
        if (typeof point.x === "number" && typeof point.y === "number") {
          anchor = {
            x: point.x,
            y: point.y,
            width:
              typeof node.width === "number" ? node.width : SCENE_CARD_WIDTH,
            height:
              typeof node.height === "number"
                ? node.height
                : SCENE_CARD_FALLBACK_HEIGHT,
          };
          hasActualAnchor = true;
        }
      }
    }
    if (!hasActualAnchor) {
      const existing: Rect[] = nodes.flatMap((candidate) => {
        if (
          !candidate ||
          typeof candidate !== "object" ||
          Array.isArray(candidate)
        ) {
          return [];
        }
        const node = candidate as Record<string, unknown>;
        const isSceneCard = node.type === "scene_card";
        const position =
          node.position &&
          typeof node.position === "object" &&
          !Array.isArray(node.position)
            ? (node.position as Record<string, unknown>)
            : {};
        return [
          {
            x: typeof position.x === "number" ? position.x : 0,
            y: typeof position.y === "number" ? position.y : 0,
            width:
              typeof node.width === "number"
                ? node.width
                : isSceneCard
                  ? SCENE_CARD_WIDTH
                  : 200,
            height:
              typeof node.height === "number"
                ? node.height
                : isSceneCard
                  ? SCENE_CARD_FALLBACK_HEIGHT
                  : 200,
          },
        ];
      });
      const position = findPlacement({
        existing,
        anchor,
        nodeWidth: SCENE_CARD_WIDTH,
        nodeHeight: SCENE_CARD_FALLBACK_HEIGHT,
      });
      anchor = {
        ...position,
        width: SCENE_CARD_WIDTH,
        height: SCENE_CARD_FALLBACK_HEIGHT,
      };
    }
  }
  return { ...input.input, placement_anchor: anchor };
}
