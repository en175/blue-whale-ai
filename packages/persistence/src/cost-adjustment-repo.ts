// IK9VZ0：cost_adjustments 审计表 repo——多退少补结算结果的接收落库（蓝鲸端只记账，不改余额）。
// 幂等：batch_no 整批唯一（整批重复 → 返回 null）；(generation_job_id, action_type) 单项唯一
// （不同 batch 对同 job 同 action 重复调整 → createMany 抛 P2002，事务回滚，由调用方感知）。
import type { PrismaClient } from "@prisma/client";

export interface CostAdjustmentItemInput {
  /** job 归属（可空：无 job 的调整仅靠整批幂等兜底）。 */
  generationJobId?: string;
  userId: string;
  projectId?: string;
  actionType: "refund" | "supplement";
  amountFen: bigint;
  reason: string;
}

export interface CostAdjustmentBatchInput {
  batchNo: string;
  /** new-api 结算时间（审计留痕）。 */
  settledAt?: string;
  items: CostAdjustmentItemInput[];
}

export function createCostAdjustmentRepo(prisma: PrismaClient) {
  return {
    /**
     * 整批落审计（batch_no 幂等）。
     * 返回 { count: N } 表示落库 N 行；返回 null 表示整批重复（batch_no 已存在，跳过）。
     * 只写 cost_adjustments 审计表，不改任何余额/预留（余额调整执行在 new-api 端）。
     */
    async createBatch(
      input: CostAdjustmentBatchInput,
    ): Promise<{ count: number } | null> {
      const existing = await prisma.cost_adjustments.count({
        where: { batch_no: input.batchNo, is_delete: 0 },
      });
      if (existing > 0) return null;

      return prisma.$transaction(async (tx) => {
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
    },
  };
}

/**
 * IK9VZ0：对齐 cost_reservations 记账——以 new-api 结算结果为准修正 settled 预留的实扣金额。
 * 语义：supplement（补扣）→ actual += amount_fen；refund（退款）→ actual -= amount_fen（下限 0）。
 * 仅对 status=settled 的预留生效；未结算/不存在则跳过。只读后写，不改余额。
 */
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
