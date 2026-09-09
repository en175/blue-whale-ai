// IKD806：plan-application 写路径已删除，共享工具仅剩 validateDerivedReferences（活跃，
// 供 scene-card-generation-repo 再生成预检消费）。其余 helper（sha256Digest/sceneCardTitle/
// toImageReceiptView/OPERATION/IMAGE_OPERATION）均为写路径专用，随死代码一并移除。
import type { Prisma } from "@prisma/client";

import type { DerivedReference } from "./plan-application-types.js";

/** AC#4：应用前重新验证冻结素材（CONTEXT L223）。
 *
 *  IKEEFV：conversation_message_mentions 表已删（唯一写入点 acceptConversationMessageInTransaction
 *  随 IKCKOW 旧引擎移除，删除时全库 0 行），mention 身份不再可解析。任何 asset/scene_card
 *  冻结引用一律 fail-closed——与「mention 行查不到」的现行为逐字一致，且不再触库。
 *  SceneCard 迁移（IKDMQM）重新定义引用来源后按需恢复查表校验。 */
export async function validateDerivedReferences(
  _tx: Prisma.TransactionClient,
  _projectId: bigint,
  derivedReferences: DerivedReference[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  for (const reference of derivedReferences) {
    return { ok: false, reason: `mention ${reference.mention_id} not found` };
  }
  return { ok: true };
}
