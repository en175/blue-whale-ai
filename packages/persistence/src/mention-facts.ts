// IKCKOW：从 agent-run-repo-internals.ts 迁出。loadMentionTargetFacts 仍被
// plan-application-image.ts（场景卡/计划流）使用，agent-run-* 旧 ops 随 IKCKOW 删除，
// 故独立成文件保留，改 plan-application-image.ts 的 import 来源。
import type { Prisma } from "@prisma/client";

import type { MentionClassificationInput } from "./mention-availability.js";

export type MentionAssetFact = NonNullable<MentionClassificationInput["asset"]> & {
  id: bigint;
};
export type MentionSceneCardFact = NonNullable<
  MentionClassificationInput["sceneCard"]
> & { id: bigint };

/** 批量查询 mention 目标的当前事实（T08）：冻结路径与实时重查闸门共用。 */
export async function loadMentionTargetFacts(
  tx: Prisma.TransactionClient,
  mentions: Array<{ mention_type: string; target_id: bigint }>,
): Promise<{
  assetById: Map<string, MentionAssetFact>;
  sceneCardById: Map<string, MentionSceneCardFact>;
}> {
  const assetIds = [
    ...new Set(
      mentions
        .filter((mention) => mention.mention_type === "asset")
        .map((mention) => mention.target_id),
    ),
  ];
  const sceneCardIds = [
    ...new Set(
      mentions
        .filter((mention) => mention.mention_type === "scene_card")
        .map((mention) => mention.target_id),
    ),
  ];
  const [assets, sceneCards] = await Promise.all([
    assetIds.length === 0
      ? []
      : tx.assets.findMany({
          where: { id: { in: assetIds } },
          select: {
            id: true,
            user_id: true,
            project_id: true,
            status: true,
            is_delete: true,
          },
        }),
    sceneCardIds.length === 0
      ? []
      : tx.scene_cards.findMany({
          where: { id: { in: sceneCardIds } },
          select: { id: true, project_id: true, version: true, is_delete: true },
        }),
  ]);
  return {
    assetById: new Map(assets.map((asset) => [asset.id.toString(), asset])),
    sceneCardById: new Map(
      sceneCards.map((sceneCard) => [sceneCard.id.toString(), sceneCard]),
    ),
  };
}
