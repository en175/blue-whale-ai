import { Controller, Get, Query } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import {
  sharedBillingClient,
  toBillingError,
  type BillingListTransactionsQuery,
} from "@lib/shared/billing/billing-client.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePageSize(raw: string | undefined): number {
  const size = Number(raw);
  return Number.isInteger(size) && size > 0
    ? Math.min(MAX_PAGE_SIZE, size)
    : DEFAULT_PAGE_SIZE;
}

@Controller("account")
export class AccountController {
  /**
   * 用户流水 —— 读 billing 的账本（`ListTransactions`）。
   *
   * <p>原先这条转发 new-api 的 `/api/log/self`，而 new-api 已降级成「带一把统一 key
   * 的上游供应商」：那把 key 是全项目共用的，问它「我的消费」只会拿到统一 key 属主的账。
   *
   * <p>⚠️ **分页是游标，不是页码**。账本是持续追加的，offset 分页会在翻页途中漏行或
   * 重复行，所以 billing 的契约里**没有总数**（要准确总数就得扫全表，而扫完那一刻它又变了）。
   * 入参 `page_token` 原样回传上一页给的 `next_page_token`，空 = 首页。
   *
   * <p>⚠️ `type` 是**单值**（consume | recharge | refund | bonus | ...），空 = 全部流水。
   * 契约不容许一次要多个类型（逗号拼接会被 billing 拒成 INVALID_ARGUMENT）。所以这里
   * 不再有「消耗 + 退款」的默认并集——默认给的是**全部**：多给几行是看得见的，
   * 少给几行（退款拿不到时账单悄悄少一半）才是查不出来的错答案。
   */
  @Get("consumptions")
  async consumptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const typeFilter = query.type?.trim() ?? "";
    const request: BillingListTransactionsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSize(query.page_size),
      pageToken: query.page_token ?? "",
      ...(typeFilter ? { typeFilter } : {}),
    };

    try {
      const page = await sharedBillingClient().listTransactions(request);
      return ok({
        items: page.items.map((item) => ({
          id: item.id,
          type: item.type,
          direction: item.direction,
          title: item.title,
          credits: item.credits,
          status: item.status,
          created_at: item.createdAt,
          settled_at: item.settledAt,
        })),
        next_page_token: page.nextPageToken,
      });
    } catch (error) {
      throw toBillingError(error, "消费记录查询不可用");
    }
  }
}
