// IK9VZ0：多退少补结算结果消费服务（new-api 端结算 → 蓝鲸端只记账）。
// 封装边界（硬约束）：本服务只有"审计落库 + 预留对齐"两个端口，不持有任何 token /
// 余额调整能力——退补执行在 new-api 端（quota 账本唯一权威），Node 不调 /api/user/manage。
import { Injectable } from "@nestjs/common";

export interface CostSettlementItem {
  /** job 归属（可空：无 job 的调整仅靠整批幂等兜底）。 */
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
  /** 对齐 cost_reservations 记账（以 new-api 结算结果为准修正 settled 预留实扣）。 */
  alignReservation: (jobId: string, item: CostSettlementItem) => Promise<void>;
}

@Injectable()
export class CostSettlementConsumer {
  constructor(private readonly deps: CostSettlementConsumerDeps) {}

  /**
   * 接收 new-api 结算结果批：只记账 + 对齐预留，绝不改用户余额。
   * 幂等：整批重复（batch_no 已存在）→ repo.createBatch 返回 null → status=duplicate（也回成功，不报错）。
   */
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
