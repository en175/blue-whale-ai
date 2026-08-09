// 计划应用仓储组合入口。实现按媒体分派拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件只做分派、组合与再导出，对外导出面保持不变。
import type { Prisma, PrismaClient } from "@prisma/client";

import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  applySceneCardCreateInTransaction,
  applySceneCardReplaceInTransaction,
} from "./plan-application-scene-card.js";
import { applyImageGenerateInTransaction } from "./plan-application-image.js";
import type {
  ApplyPlanMessageInput,
  ApplyPlanMessageResult,
  PlanApplicationRepo,
} from "./plan-application-types.js";

export * from "./plan-application-types.js";
export { validateDerivedReferences } from "./plan-application-internals.js";

async function applyPlanMessageInTransaction(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
): Promise<ApplyPlanMessageResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);

  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" };

  const planMessage = await tx.plan_messages.findUnique({
    where: { message_id: BigInt(input.planMessageId) },
  });
  if (!planMessage || planMessage.project_id !== projectId)
    return { kind: "plan_not_found" };

  if (planMessage.application_kind === "scene_card_create") {
    return applySceneCardCreateInTransaction(tx, input, planMessage);
  }
  if (planMessage.application_kind === "scene_card_replace") {
    return applySceneCardReplaceInTransaction(tx, input, planMessage);
  }
  if (planMessage.application_kind === "image_generate") {
    if (!input.providerCredential || !input.quotaCheck) {
      return {
        kind: "validation_failed",
        reason: "missing generation credential",
      };
    }
    return applyImageGenerateInTransaction(tx, input, planMessage);
  }
  return { kind: "kind_unsupported" };
}

export function createPlanApplicationRepo(
  prisma: PrismaClient,
): PlanApplicationRepo {
  return {
    applyPlanMessage(input) {
      return transactionWithUniqueRetry(prisma, (tx) =>
        applyPlanMessageInTransaction(tx, input),
      );
    },
  };
}
