import { Controller, Get, Headers, Query } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { ok } from "@lib/contracts";
import { AccountService } from "@lib/shared/account/account.service.js";
import {
  mapPaymentMethodLabel,
  mapTopUpStatus,
  parseConsumeLogTypes,
  parseRecordPaging,
  toAccountConsumptionItem,
  topUpCreditsGained,
} from "@lib/shared/account/records.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { toUpstreamError } from "@lib/shared/errors/upstream-error.js";

@Controller("account")
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get("consumptions")
  async consumptions(
    @Headers("authorization") authorization?: string,
    @Query() query: Record<string, string> = {},
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("未提供有效令牌", 401, "unauthorized");
    const searchParams = new URLSearchParams(query);
    const { page, pageSize } = parseRecordPaging(searchParams);
    // 参数校验放在 try 之外：非法 type 是 400 的客户端错误，不该被 toUpstreamError 当成上游故障。
    const type = parseConsumeLogTypes(searchParams);
    try {
      const result = await this.account.listUserConsumeLogs(token, {
        page,
        pageSize,
        type,
      });
      return ok({
        items: result.items.map(toAccountConsumptionItem),
        total: result.total,
      });
    } catch (error) {
      throw toUpstreamError(error, "消费记录查询不可用");
    }
  }

  @Get("topups")
  async topups(
    @Headers("authorization") authorization?: string,
    @Query() query: Record<string, string> = {},
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("未提供有效令牌", 401, "unauthorized");
    const { page, pageSize } = parseRecordPaging(new URLSearchParams(query));
    try {
      const result = await this.account.listUserTopUps(token, { page, pageSize });
      return ok({
        items: result.items.map((record) => ({
          trade_no: record.trade_no,
          credits: topUpCreditsGained(record.amount),
          amount_cny: record.money,
          payment_method: mapPaymentMethodLabel(record.payment_method),
          status: mapTopUpStatus(record.status),
          created_at: record.create_time,
        })),
        total: result.total,
      });
    } catch (error) {
      throw toUpstreamError(error, "充值记录查询不可用");
    }
  }
}
