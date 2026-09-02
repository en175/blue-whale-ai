// IKCKOW：旧内嵌 Agent 引擎的 acceptConversationMessageInTransaction /
// createConversationRepo 已随旧 Agent 运行表删除（用户确认 6 表删除 + 2 表保留）。
// 本文件仅保留 transactionWithUniqueRetry（live，被 generation-command /
// plan-application / scene-card-* / storyboard-preview-repo 使用）。
import type { Prisma, PrismaClient } from "@prisma/client";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export async function transactionWithUniqueRetry<T>(
  prisma: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(operation);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.$transaction(operation);
  }
}
