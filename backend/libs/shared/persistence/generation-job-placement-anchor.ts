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
    project_canvas?: {
      findFirst(args: unknown): Promise<{
        viewport_json: unknown;
      } | null>;
    };
  };
  if (!ports.project_canvas?.findFirst) return input.input;

  const canvas = await ports.project_canvas.findFirst({
    where: { project_id: BigInt(input.projectId) },
    select: { viewport_json: true },
  });
  const viewport =
    canvas?.viewport_json &&
    typeof canvas.viewport_json === "object" &&
    !Array.isArray(canvas.viewport_json)
      ? (canvas.viewport_json as Record<string, unknown>)
      : {};
  const zoom =
    typeof viewport.zoom === "number" && viewport.zoom > 0 ? viewport.zoom : 1;
  const anchor = {
    x: -(typeof viewport.x === "number" ? viewport.x : 0) / zoom,
    y: -(typeof viewport.y === "number" ? viewport.y : 0) / zoom,
    width: 0,
    height: 0,
  };

  return { ...input.input, placement_anchor: anchor };
}
