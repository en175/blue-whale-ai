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
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  try {
    return await prisma.$transaction(operation, options);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return prisma.$transaction(operation, options);
  }
}
