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

/**
 * 页码：缺省 / 非法 / 小于 1 一律当第一页。
 *
 * <p>不夹的话 `(page - 1) * size` 会算出负的 OFFSET，MySQL 直接语法错、整个请求 500 ——
 * 而调用方只是传了个 `page=0`。客户端从 0 起算是很常见的写法，这里必须兜住。
 */
function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * 类型过滤：**逗号分隔的多值**。
 *
 * <p>空串、纯空白、多余分隔符都会滤掉，所以 `type=consume,,expire,` 等价于两个值。
 * 校验在 billing 侧做（含未知值 → INVALID_ARGUMENT），这一层只负责拆分。
 */
function parseTypes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

@Controller("account")
export class AccountController {
  /**
   * 用户流水 —— 读 billing 的账本（`ListTransactions`）。
   *
   * <p>原先这条转发 new-api 的 `/api/log/self`，而 new-api 已降级成「带一把统一 key
   * 的上游供应商」：那把 key 是全项目共用的，问它「我的消费」只会拿到统一 key 属主的账。
   *
   * <p>⚠️ **分页是 offset 页码 + 总数**（2026-09-30 由游标改来，见契约的
   * `common/v1/types.proto`）。入参 `page`（从 1 起，缺省 1）、`page_size`（缺省 20、上限 100）；
   * 响应 `total` 是满足同一组条件的总条数。
   *
   * <p>⚠️ 换 offset 的代价是真实的：账本持续追加，翻页途中新插入的行会把后面的行整体下移，
   * 用户可能看到重复行。换的是列表上的「共 N 条」与页码，留痕见前端对接文档 §6.2。
   *
   * <p>⚠️ `type` 是**逗号分隔的多值**（consume | recharge | refund | expire | ...），空 = 全部。
   * 用户的「已消耗」页签要一次取 `consume,expire`（过期核销并入消耗）。未知值由 billing
   * 拒成 INVALID_ARGUMENT —— **每一个值都校验**，不是只看第一个。
   */
  @Get("consumptions")
  async consumptions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const types = parseTypes(query.type);
    const request: BillingListTransactionsQuery = {
      userId: Number(user.userId),
      pageSize: parsePageSize(query.page_size),
      page: parsePage(query.page),
      ...(types.length ? { typeFilters: types } : {}),
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
        total: page.total,
      });
    } catch (error) {
      throw toBillingError(error, "消费记录查询不可用");
    }
  }
}
