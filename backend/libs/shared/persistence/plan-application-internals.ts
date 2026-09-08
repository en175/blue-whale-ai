// IKD806：plan-application 写路径已删除，共享工具仅剩 validateDerivedReferences（活跃，
// 供 scene-card-generation-repo 再生成预检消费）。其余 helper（sha256Digest/sceneCardTitle/
// toImageReceiptView/OPERATION/IMAGE_OPERATION）均为写路径专用，随死代码一并移除。
import type { Prisma } from "@prisma/client";

import type { DerivedReference } from "./plan-application-types.js";

/** AC#4：应用前重新验证冻结素材（CONTEXT L223）。derived_reference.mention_id 指向
 *  conversation_message_mentions.id，其 target_id 指向 asset/scene_card；任一目标被删/失效则零写入。 */
export async function validateDerivedReferences(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  derivedReferences: DerivedReference[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (derivedReferences.length === 0) return { ok: true };

  const assetMentionIds = derivedReferences
    .filter((reference) => reference.type === "asset")
    .map((reference) => BigInt(reference.mention_id));
  const sceneCardMentionIds = derivedReferences
    .filter((reference) => reference.type === "scene_card")
    .map((reference) => BigInt(reference.mention_id));

  if (assetMentionIds.length > 0) {
    const mentions = await tx.conversation_message_mentions.findMany({
      where: { id: { in: assetMentionIds } },
      select: { id: true, target_id: true, project_id: true },
    });
    const mentionByHandle = new Map(
      mentions.map((mention) => [mention.id, mention]),
    );
    const assetIds = mentions.map((mention) => mention.target_id);
    const assets =
      assetIds.length === 0
        ? []
        : await tx.assets.findMany({
            where: { id: { in: assetIds } },
            select: {
              id: true,
              project_id: true,
              status: true,
              is_delete: true,
            },
          });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    for (const reference of derivedReferences.filter(
      (r) => r.type === "asset",
    )) {
      const mention = mentionByHandle.get(BigInt(reference.mention_id));
      if (!mention)
        return {
          ok: false,
          reason: `mention ${reference.mention_id} not found`,
        };
      if (mention.project_id !== projectId)
        return {
          ok: false,
          reason: `mention ${reference.mention_id} wrong project`,
        };
      const asset = assetById.get(mention.target_id);
      if (!asset || asset.is_delete || asset.status !== "normal")
        return {
          ok: false,
          reason: `asset for mention ${reference.mention_id} unavailable`,
        };
      if (asset.project_id !== projectId)
        return {
          ok: false,
          reason: `asset for mention ${reference.mention_id} wrong project`,
        };
    }
  }

  if (sceneCardMentionIds.length > 0) {
    const mentions = await tx.conversation_message_mentions.findMany({
      where: { id: { in: sceneCardMentionIds } },
      select: { id: true, target_id: true, project_id: true },
    });
    const mentionByHandle = new Map(
      mentions.map((mention) => [mention.id, mention]),
    );
    const sceneCardIds = mentions.map((mention) => mention.target_id);
    const sceneCards =
      sceneCardIds.length === 0
        ? []
        : await tx.scene_cards.findMany({
            where: { id: { in: sceneCardIds } },
            select: { id: true, project_id: true, is_delete: true },
          });
    const sceneCardById = new Map(sceneCards.map((card) => [card.id, card]));
    for (const reference of derivedReferences.filter(
      (r) => r.type === "scene_card",
    )) {
      const mention = mentionByHandle.get(BigInt(reference.mention_id));
      if (!mention)
        return {
          ok: false,
          reason: `mention ${reference.mention_id} not found`,
        };
      const card = sceneCardById.get(mention.target_id);
      if (!card || card.is_delete === 1)
        return {
          ok: false,
          reason: `scene_card for mention ${reference.mention_id} unavailable`,
        };
    }
  }

  return { ok: true };
}
