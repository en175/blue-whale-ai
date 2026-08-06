import {
  findPlacement,
  intersects,
  SCENE_CARD_FALLBACK_HEIGHT,
  SCENE_CARD_WIDTH,
  type Rect,
} from "@blue-whale/core";
import type { CanvasRepo, CanvasView } from "@blue-whale/persistence";

/** IK67H9 / T11 第二阶段：把 SceneCardNode 放进 Canvas（CONTEXT L71-77 / AC#5）。
 *  幂等：同一 Canvas 同一 SceneCard 最多一个节点（节点身份由 SceneCard 身份确定性生成）。
 *  锚点近似：viewport_json 只存 {x,y,zoom}、无屏幕尺寸，以屏幕原点反投近似
 *  「视口中心附近」落点（精确中心需携带视口尺寸，交 T14）；失败不回滚第一阶段、不重试（交 T14）。
 *
 *  IK67HE/T14：新增 recoverPendingPlacements —— 放置作为可重试的第二阶段幂等恢复（spec §4.5）。
 *  读取最新布局，只补 status=pending 的节点落位，不移动已 placed 节点；连续冲突保持 pending。 */

interface CanvasNodeLike {
  id?: string;
  type?: string;
  scene_card_id?: string | number;
  sceneCardId?: string;
  assetId?: string;
  taskId?: string;
  slotIndex?: number;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  status?: string;
  [key: string]: unknown;
}

export interface PlacementRecoveryResult {
  placed: string[];
  still_pending: string[];
  canvas: CanvasView;
}

export interface PendingOutputPlacement {
  slot_id: string;
  generation_job_id: string;
  slot_index: number;
  asset_id: string;
  type: "image" | "video";
  scene_card_id: string | null;
  placement_anchor: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface OutputPlacementPort {
  listPending(projectId: string): Promise<PendingOutputPlacement[]>;
  markPlaced(slotId: string): Promise<void>;
}

function outputNodeId(slotId: string): string {
  return `generation-output:${slotId}`;
}

function outputDimensions(type: "image" | "video"): {
  width: number;
  height: number;
} {
  return type === "video"
    ? { width: VIDEO_OUTPUT_WIDTH, height: VIDEO_OUTPUT_HEIGHT }
    : { width: IMAGE_OUTPUT_WIDTH, height: IMAGE_OUTPUT_HEIGHT };
}

function canvasNodeDimensions(node: CanvasNodeLike): {
  width: number;
  height: number;
} {
  if (node.type === "scene_card") {
    return {
      width: node.width ?? SCENE_CARD_WIDTH,
      height: node.height ?? SCENE_CARD_FALLBACK_HEIGHT,
    };
  }
  if (node.type === "video") {
    return {
      width: node.width ?? VIDEO_OUTPUT_WIDTH,
      height: node.height ?? VIDEO_OUTPUT_HEIGHT,
    };
  }
  if (node.type === "image") {
    return {
      width: node.width ?? IMAGE_OUTPUT_WIDTH,
      height: node.height ?? IMAGE_OUTPUT_HEIGHT,
    };
  }
  return { width: node.width ?? 200, height: node.height ?? 200 };
}

function sceneCardIdOf(node: CanvasNodeLike): string | null {
  if (node.sceneCardId) return node.sceneCardId;
  if (node.scene_card_id != null) return String(node.scene_card_id);
  const data = node.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const sceneCardId = (data as Record<string, unknown>).sceneCardId;
    if (sceneCardId != null) return String(sceneCardId);
  }
  return null;
}

/** 视口 {x,y,zoom} → 近似世界锚点（屏幕原点反投）；缺省回 {0,0}。 */
function viewportAnchor(viewport: string | null): { x: number; y: number } {
  if (!viewport) return { x: 0, y: 0 };
  try {
    const parsed = JSON.parse(viewport) as {
      x?: number;
      y?: number;
      zoom?: number;
    };
    const zoom =
      typeof parsed.zoom === "number" && parsed.zoom > 0 ? parsed.zoom : 1;
    const x = typeof parsed.x === "number" ? parsed.x : 0;
    const y = typeof parsed.y === "number" ? parsed.y : 0;
    return { x: -x / zoom, y: -y / zoom };
  } catch {
    return { x: 0, y: 0 };
  }
}

export async function placeSceneCardNode(
  canvas: CanvasRepo,
  projectId: string,
  sceneCardId: string,
): Promise<void> {
  const view = await canvas.getByProject(projectId);
  const nodes: CanvasNodeLike[] = view.nodes
    ? (JSON.parse(view.nodes) as CanvasNodeLike[])
    : [];

  // 幂等：同一 SceneCard 已有节点即视为成功（CONTEXT L66）。
  const exists = nodes.some(
    (node) =>
      node.type === "scene_card" && String(node.scene_card_id) === sceneCardId,
  );
  if (exists) return;

  const existing: Rect[] = nodes.map((node) => ({
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    ...canvasNodeDimensions(node),
  }));
  const position = findPlacement({
    existing,
    anchor: viewportAnchor(view.viewport),
    nodeWidth: SCENE_CARD_WIDTH,
    nodeHeight: SCENE_CARD_FALLBACK_HEIGHT,
  });

  const nextNode: CanvasNodeLike = {
    id: `scene_card_${sceneCardId}`,
    type: "scene_card",
    scene_card_id: sceneCardId,
    position,
    width: SCENE_CARD_WIDTH,
    height: SCENE_CARD_FALLBACK_HEIGHT,
    status: "pending",
  };

  await canvas.save(
    projectId,
    view.viewport,
    JSON.stringify([...nodes, nextNode]),
  );
}

/** 幂等恢复放置（spec §4.5「Canvas 冲突时重新读取最新布局，只加入缺失的确定性节点」）：
 *  扫 nodes 中 status=pending 的 scene_card 节点，用 findPlacement 在既有 placed 节点之外找空位；
 *  成功落位标 placed，仍冲突的保持 pending（可再次重试）。
 *  不重复计划应用、不创建 SceneCard/Receipt/Job。 */
export async function recoverPendingPlacements(
  canvas: CanvasRepo,
  projectId: string,
  outputPlacements?: OutputPlacementPort,
): Promise<PlacementRecoveryResult> {
  const pendingOutputs = outputPlacements
    ? await outputPlacements.listPending(projectId)
    : [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const view = await canvas.getByProject(projectId);
    const nodes: CanvasNodeLike[] = view.nodes
      ? (JSON.parse(view.nodes) as CanvasNodeLike[])
      : [];
    const occupied: Rect[] = nodes
      .filter((n) => n.status !== "pending")
      .map((node) => ({
        x: node.position?.x ?? 0,
        y: node.position?.y ?? 0,
        ...canvasNodeDimensions(node),
      }));
    const placed: string[] = [];
    const placedSlotIds: string[] = [];
    const stillPending: string[] = [];
    let changed = false;

    for (const node of nodes) {
      if (node.type !== "scene_card" || node.status !== "pending") continue;
      const { width: nodeWidth, height: nodeHeight } =
        canvasNodeDimensions(node);
      const position = findPlacement({
        existing: occupied,
        anchor: viewportAnchor(view.viewport),
        nodeWidth,
        nodeHeight,
      });
      const nodeRect = { ...position, width: nodeWidth, height: nodeHeight };
      if (occupied.some((rect) => intersects(rect, nodeRect))) {
        if (node.id) stillPending.push(node.id);
        continue;
      }
      node.position = position;
      node.width = nodeWidth;
      node.height = nodeHeight;
      node.status = "placed";
      occupied.push(nodeRect);
      if (node.id) placed.push(node.id);
      changed = true;
    }

    for (const output of pendingOutputs) {
      const deterministicId = outputNodeId(output.slot_id);
      if (nodes.some((node) => node.id === deterministicId)) {
        placed.push(deterministicId);
        placedSlotIds.push(output.slot_id);
        continue;
      }

      let position: { x: number; y: number };
      const dimensions = outputDimensions(output.type);
      if (output.scene_card_id) {
        const sceneCardNode = nodes.find(
          (node) =>
            node.type === "scene_card" &&
            sceneCardIdOf(node) === output.scene_card_id,
        );
        const basePosition = sceneCardNode?.position
          ? {
              x: sceneCardNode.position.x,
              y:
                sceneCardNode.position.y +
                canvasNodeDimensions(sceneCardNode).height +
                OUTPUT_GAP,
            }
          : output.placement_anchor
            ? {
                x: output.placement_anchor.x,
                y:
                  output.placement_anchor.y +
                  output.placement_anchor.height +
                  OUTPUT_GAP,
              }
            : null;
        if (basePosition) {
          const siblings = nodes.filter(
            (node) =>
              (node.type === "image" || node.type === "video") &&
              sceneCardIdOf(node) === output.scene_card_id,
          );
          position = {
            x: basePosition.x,
            y: siblings.reduce((nextY, sibling) => {
              if (!sibling.position) return nextY;
              return Math.max(
                nextY,
                sibling.position.y +
                  canvasNodeDimensions(sibling).height +
                  OUTPUT_GAP,
              );
            }, basePosition.y),
          };
        } else {
          position = findPlacement({
            existing: occupied,
            anchor: viewportAnchor(view.viewport),
            nodeWidth: dimensions.width,
            nodeHeight: dimensions.height,
          });
        }
      } else {
        position = findPlacement({
          existing: occupied,
          anchor: output.placement_anchor ?? viewportAnchor(view.viewport),
          nodeWidth: dimensions.width,
          nodeHeight: dimensions.height,
        });
      }
      if (
        occupied.some((rect) =>
          intersects(rect, { ...position, ...dimensions }),
        )
      ) {
        position = findPlacement({
          existing: occupied,
          anchor: {
            x: position.x + dimensions.width / 2,
            y: position.y + dimensions.height / 2,
          },
          nodeWidth: dimensions.width,
          nodeHeight: dimensions.height,
        });
      }
      if (
        occupied.some((rect) =>
          intersects(rect, { ...position, ...dimensions }),
        )
      ) {
        stillPending.push(deterministicId);
        continue;
      }
      const node: CanvasNodeLike = {
        id: deterministicId,
        type: output.type,
        assetId: output.asset_id,
        taskId: output.generation_job_id,
        slotIndex: output.slot_index,
        ...(output.scene_card_id ? { sceneCardId: output.scene_card_id } : {}),
        position,
        width: dimensions.width,
        height: dimensions.height,
        status: "placed",
      };
      nodes.push(node);
      occupied.push({
        ...position,
        width: dimensions.width,
        height: dimensions.height,
      });
      placed.push(deterministicId);
      placedSlotIds.push(output.slot_id);
      changed = true;
    }

    let savedView = view;
    if (changed) {
      const saved = await canvas.saveIfVersion(
        projectId,
        view.version,
        view.viewport,
        JSON.stringify(nodes),
      );
      if (!saved) continue;
      savedView = saved;
    }
    if (outputPlacements) {
      for (const slotId of placedSlotIds) {
        await outputPlacements.markPlaced(slotId);
      }
    }
    return { placed, still_pending: stillPending, canvas: savedView };
  }

  const latest = await canvas.getByProject(projectId);
  return {
    placed: [],
    still_pending: pendingOutputs.map((output) => outputNodeId(output.slot_id)),
    canvas: latest,
  };
}

const VIDEO_OUTPUT_WIDTH = 400;
const VIDEO_OUTPUT_HEIGHT = 225;
const IMAGE_OUTPUT_WIDTH = 200;
const IMAGE_OUTPUT_HEIGHT = 112;
const OUTPUT_GAP = 10;
