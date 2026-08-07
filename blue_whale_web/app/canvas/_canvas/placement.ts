/**
 * placement —— 占位节点落点算法（design D2）。
 *
 * 视口中心锚 + 行优先网格不重叠搜索的纯函数已抽到 @blue-whale/core/placement（IK67H9 / T11
 * 让后端 Canvas 第二阶段放置可复用同一算法）；本文件 re-export 保持前端调用方不变，
 * 并保留前端专属的 pickReferenceDropTarget（依赖 productImport，不进 core）。
 */
import { MAX_PRODUCT_IMAGES } from "./productImport";

export {
  findPlacement,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_GAP,
  DEFAULT_MAX_PER_ROW,
} from "@blue-whale/core";
export type { Rect, FindPlacementOptions } from "@blue-whale/core";

/**
 * IK55VT 通道一：画布内拖素材节点上参考卡落槽的目标判定（纯函数）。
 * 仅图片素材（有 assetId 的完成态）可落；相交候选（RF getIntersectingNodes 结果）中取第一个参考卡。
 * IK55VZ 商品卡：已满 8 图的 product 卡跳过（满了不再追加）。
 */
export function pickReferenceDropTarget(
  dragged: { kind: string; assetId?: string },
  intersecting: Array<{
    id: string;
    kind: string;
    /** IK55VZ：参考卡类型与当前图数（product 满 8 判定用；缺省视为可落）。 */
    cardType?: string;
    imageCount?: number;
  }>,
): string | null {
  if (dragged.kind !== "image" || !dragged.assetId) return null;
  return (
    intersecting.find(
      (n) =>
        n.kind === "reference" &&
        !(
          n.cardType === "product" && (n.imageCount ?? 0) >= MAX_PRODUCT_IMAGES
        ),
    )?.id ?? null
  );
}
