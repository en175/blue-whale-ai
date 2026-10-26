import type { PrismaClient } from "@prisma/client";

export interface CostAdjustmentItemInput {
  generationJobId?: string;
  userId: string;
  projectId?: string;
  actionType: "refund" | "supplement";
  amountFen: bigint;
  reason: string;
}

export interface CostAdjustmentBatchInput {
  batchNo: string;
  settledAt?: string;
  items: CostAdjustmentItemInput[];
}

export function createCostAdjustmentRepo(prisma: PrismaClient) {
  return {
    async createBatch(
      input: CostAdjustmentBatchInput,
    ): Promise<{ count: number } | null> {
      const existing = await prisma.cost_adjustments.count({
        where: { batch_no: input.batchNo, is_delete: 0 },
      });
      if (existing > 0) return null;

      try {
        return await prisma.$transaction(async (tx) => {
          await tx.cost_adjustments.createMany({
            data: input.items.map((it) => ({
              batch_no: input.batchNo,
              generation_job_id: it.generationJobId
                ? BigInt(it.generationJobId)
                : null,
              user_id: BigInt(it.userId),
              project_id: it.projectId ? BigInt(it.projectId) : null,
              action_type: it.actionType,
              amount_fen: it.amountFen,
              reason: it.reason,
              status: "applied",
              new_api_snapshot: input.settledAt ?? null,
            })),
          });
          return { count: input.items.length };
        });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}

export async function alignReservationBySettlement(
  prisma: PrismaClient,
  jobId: string,
  item: Pick<CostAdjustmentItemInput, "actionType" | "amountFen">,
): Promise<void> {
  const row = await prisma.cost_reservations.findFirst({
    where: { generation_job_id: BigInt(jobId), is_delete: 0, status: "settled" },
  });
  if (!row) return;
  const current = row.actual_amount_fen ?? 0n;
  const next =
    item.actionType === "supplement"
      ? current + item.amountFen
      : current - item.amountFen;
  await prisma.cost_reservations.update({
    where: { id: row.id },
    data: { actual_amount_fen: next < 0n ? 0n : next },
  });
}
