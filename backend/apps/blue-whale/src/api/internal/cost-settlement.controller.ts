import { createHash, timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import {
  CostSettlementConsumer,
  type CostSettlementBatch,
} from "@lib/shared/cost-reconciliation/cost-settlement-consumer.service.js";

function authorizedService(header: string | undefined): boolean {
  const expected = process.env.COST_SETTLEMENT_SERVICE_TOKEN?.trim();
  const supplied = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}

@Public()
@BypassTransform()
@Controller("internal/cost-settlements")
export class CostSettlementInternalController {
  constructor(private readonly consumer: CostSettlementConsumer) {}

  @Post()
  async receive(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ) {
    if (!authorizedService(authorization)) {
      throw new NewApiError("服务凭证无效", 401, "unauthorized");
    }
    const batch = body as CostSettlementBatch;
    if (
      !batch ||
      typeof batch.batchNo !== "string" ||
      batch.batchNo.length === 0 ||
      !Array.isArray(batch.items) ||
      batch.items.length === 0
    ) {
      throw new NewApiError("结算批次请求无效", 400, "invalid_batch");
    }
    for (const item of batch.items) {
      const jobIdValid =
        item.jobId === undefined || /^[1-9][0-9]*$/.test(String(item.jobId));
      if (
        !item ||
        (item.action !== "refund" && item.action !== "supplement") ||
        !Number.isInteger(item.amountFen) ||
        item.amountFen <= 0 ||
        !Number.isInteger(item.userId) ||
        item.userId <= 0 ||
        typeof item.reason !== "string" ||
        item.reason.trim().length === 0 ||
        item.reason.length > 255 ||
        !jobIdValid
      ) {
        throw new NewApiError("结算批次项无效", 400, "invalid_item");
      }
    }
    const result = await this.consumer.consume({
      batchNo: batch.batchNo,
      ...(batch.settledAt ? { settledAt: batch.settledAt } : {}),
      items: batch.items.map((it) => ({
        ...(it.jobId ? { jobId: it.jobId } : {}),
        userId: it.userId,
        action: it.action,
        amountFen: BigInt(it.amountFen),
        reason: it.reason,
      })),
    });
    return { batch_no: batch.batchNo, status: result.status };
  }
}
