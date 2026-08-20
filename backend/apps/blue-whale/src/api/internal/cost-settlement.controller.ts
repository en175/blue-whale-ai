// IK9VZ0：多退少补结算结果内部接收接口（服务间鉴权，非用户端路由）。
// 挂在 internal 命名空间：@Public + 服务间 token 校验；禁止用户会话访问。
// 用户端（web 前端 + 用户可调 /api/**）不存在任何"退款/补偿/调余额"入口（边界 grep 验证）。
import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, Post } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import {
  CostSettlementConsumer,
  type CostSettlementBatch,
} from "@lib/shared/cost-reconciliation/cost-settlement-consumer.service.js";

/** 服务间鉴权：与 new-api 侧约定共享密钥（env COST_SETTLEMENT_SERVICE_TOKEN），timingSafeEqual 防时序侧信道。 */
function authorizedService(header: string | undefined): boolean {
  const expected = process.env.COST_SETTLEMENT_SERVICE_TOKEN?.trim();
  const supplied = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

@Public()
@BypassTransform()
@Controller("internal/cost-settlements")
export class CostSettlementInternalController {
  constructor(private readonly consumer: CostSettlementConsumer) {}

  /** POST /internal/cost-settlements — 接收 new-api 结算结果批（批量，含 batch_no）。
   *  幂等：重复批次返回 status=duplicate（也回成功，new-api 侧重试安全）。 */
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
      !Array.isArray(batch.items)
    ) {
      throw new NewApiError("结算批次请求无效", 400, "invalid_batch");
    }
    for (const item of batch.items) {
      // JSON 无 bigint：amountFen 以整数 number（分）传输（契约 cost-settlement-sync-contract.md），
      // 校验后统一转 bigint 再消费（IK9VZ0 修复：此前误用 typeof bigint 导致所有请求 400）。
      if (
        !item ||
        (item.action !== "refund" && item.action !== "supplement") ||
        !Number.isInteger(item.amountFen) ||
        item.amountFen <= 0 ||
        typeof item.userId !== "number"
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
