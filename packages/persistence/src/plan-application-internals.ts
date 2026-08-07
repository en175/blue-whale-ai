// IK74V8：从 plan-application-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 共享工具：内容摘要、场景卡标题派生、引用校验与图片回执投影。
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

import type { DerivedReference } from "./plan-application-types.js";
import type { PlanApplyImageReceipt } from "@blue-whale/contracts";

export const OPERATION = "plan.message.apply";
/** 图片应用幂等操作名（与视频路径分列，避免跨媒体 CommandId 误判重放）。 */
export const IMAGE_OPERATION = "plan_message.apply";

export function sha256Digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** scene_cards.title 是 NOT NULL，但 plan_messages 只冻结 sequence_label（可空）与 content_markdown。
 *  title 取 sequence_label，缺失时从正文首行派生（剥离 asset:// 引用），兜底「场景卡」。 */
export function sceneCardTitle(
  sequenceLabel: string | null,
  contentMarkdown: string,
): string {
  if (sequenceLabel && sequenceLabel.trim().length > 0) {
    return sequenceLabel.slice(0, 255);
  }
  const firstLine =
    contentMarkdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? contentMarkdown.trim();
  const cleaned = firstLine.replace(/asset:\/\/[0-9]+/g, "").trim();
  return (cleaned || "场景卡").slice(0, 255);
}

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

/** 场景卡应用事务（create/replace）的 plan_message 视图：共享前置校验 + 各自写入阶段共用。
 *  dispatcher 读 plan_messages 整行后传入；create/replace 各取所需字段。 */

export function toImageReceiptView(row: {
  id: bigint;
  message_id: bigint;
  project_id: bigint;
  conversation_id: bigint | null;
  agent_run_id: bigint | null;
  first_generation_job_id: bigint;
  content_digest: string;
  applied_at: Date;
}): PlanApplyImageReceipt {
  return {
    receipt_id: row.id.toString(),
    plan_message_id: row.message_id.toString(),
    project_id: row.project_id.toString(),
    conversation_id: (row.conversation_id ?? 0n).toString(),
    agent_run_id: (row.agent_run_id ?? 0n).toString(),
    first_generation_job_id: row.first_generation_job_id.toString(),
    content_digest: row.content_digest,
    applied_at: row.applied_at.toISOString(),
    application_kind: "image_generate",
    scene_card_id: null,
  };
}

/** 单事务原子应用 image_generate PlanMessage（T10）。
 *  双层幂等（PlanMessage at-most-once + CommandId）+ 预检（mention/能力/余额，硬失败零写入）
 *  + 同 tx 建首图 job + receipt + plan_message.applied 事件。 */
