import { Injectable } from "@nestjs/common";

export interface CostSettlementItem {
  jobId?: string;
  userId: number;
  action: "refund" | "supplement";
  amountFen: bigint;
  reason: string;
}

export interface CostSettlementBatch {
  batchNo: string;
  settledAt?: string;
  items: CostSettlementItem[];
}

export interface CostSettlementConsumerDeps {
  repo: {
    createBatch(input: {
      batchNo: string;
      settledAt?: string;
      items: Array<{
        generationJobId?: string;
        userId: string;
        actionType: "refund" | "supplement";
        amountFen: bigint;
        reason: string;
      }>;
    }): Promise<{ count: number } | null>;
  };
  alignReservation: (jobId: string, item: CostSettlementItem) => Promise<void>;
}

@Injectable()
export class CostSettlementConsumer {
  constructor(private readonly deps: CostSettlementConsumerDeps) {}

  async consume(
    batch: CostSettlementBatch,
  ): Promise<{ status: "applied" | "duplicate" }> {
    const created = await this.deps.repo.createBatch({
      batchNo: batch.batchNo,
      ...(batch.settledAt ? { settledAt: batch.settledAt } : {}),
      items: batch.items.map((it) => ({
        ...(it.jobId ? { generationJobId: it.jobId } : {}),
        userId: String(it.userId),
        actionType: it.action,
        amountFen: it.amountFen,
        reason: it.reason,
      })),
    });
    if (!created || created.count === 0) return { status: "duplicate" };
    for (const item of batch.items) {
      if (item.jobId) await this.deps.alignReservation(item.jobId, item);
    }
    return { status: "applied" };
  }
}
