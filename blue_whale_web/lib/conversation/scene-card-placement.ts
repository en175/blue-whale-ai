import { findPlacement, type Rect } from "@blue-whale/core";
import type { CanvasRepo } from "@blue-whale/persistence";

/** IK67H9 / T11 第二阶段：把 SceneCardNode 放进 Canvas（CONTEXT L71-77 / AC#5）。
 *  幂等：同一 Canvas 同一 SceneCard 最多一个节点（节点身份由 SceneCard 身份确定性生成）。
 *  锚点近似：viewport_json 只存 {x,y,zoom}、无屏幕尺寸，以屏幕原点反投近似
 *  「视口中心附近」落点（精确中心需携带视口尺寸，交 T14）；失败不回滚第一阶段、不重试（交 T14）。 */

interface CanvasNodeLike {
  id?: string;
  type?: string;
  scene_card_id?: string | number;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  [key: string]: unknown;
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
    width: node.width ?? 200,
    height: node.height ?? 200,
  }));
  const position = findPlacement({
    existing,
    anchor: viewportAnchor(view.viewport),
    nodeWidth: 240,
    nodeHeight: 135, // 视频场景卡 16:9
  });

  const nextNode: CanvasNodeLike = {
    id: `scene_card_${sceneCardId}`,
    type: "scene_card",
    scene_card_id: sceneCardId,
    position,
    width: 240,
    height: 135,
    status: "pending",
  };

  await canvas.save(
    projectId,
    view.viewport,
    JSON.stringify([...nodes, nextNode]),
  );
}
