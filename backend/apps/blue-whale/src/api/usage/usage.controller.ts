import { Controller, Get } from "@nestjs/common";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { sharedBillingClient, toBillingError } from "@lib/shared/billing/billing-client.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/**
 * 余额查询。
 *
 * <p>数据源是 **billing 的账本**（`QueryBalance`）。原先这里转发 new-api 的
 * `/api/usage/token`，而 new-api 已降级成「带一把统一 key 的上游供应商」——
 * 那把 key 是全项目共用的，问它「余额多少」只会得到统一 key 属主一个人的余额。
 *
 * <p>返回的 `credits` 是**整数积分**（账本单位），不是 new-api 的 quota：
 * 用户看到的数就是 billing 记的数，中间不再有一次 50,000 的换算。
 *
 * <p>`by_source` 是同一笔余额**按来源拆开**的分量（充值 / 充值赠送 / 每日赠送…）。
 * ⚠️ 它不是第二个金额：**Σ by_source 逐字等于 `credits`**（服务端由同一条 SQL 的
 * 两种投影保证）。前端「总积分 = 各类型之和」靠的就是这个等式；两边对不上是 bug，
 * 不是口径差异。`credits` 保留不动，是为了既有消费端（画布顶栏、额度闸、充值弹窗）
 * 不必跟着改。
 *
 * <p>`expiring` 是**临期批次**（账户积分与订单页的「最近到期批次」用它）。
 * ⚠️ 它是**子集**，不是全部批次：上游只返回「最近会到期」的那几条。要完整的批次台账
 * 走 `/api/account/credit-lots`。也**不是第二个金额** —— 这些批次的钱已经算在 `credits` 里了。
 */
@Controller("usage")
export class UsageController {
  @Get("token")
  async token(@CurrentUser() user: AuthenticatedUser) {
    try {
      const balance = await sharedBillingClient().queryBalance(Number(user.userId));
      return ok({
        credits: balance.availableCredits,
        by_source: balance.bySource.map((item) => ({
          source: item.source,
          credits: item.credits,
        })),
        // 上游早就返回了（gRPC QueryBalance.expiring + 客户端映射都在），此前只是这一层
        // 没投影出来。契约里 `expires_at` 是 RFC3339，`source` 是**批次口径**
        // （purchased | bonus | …），不是流水口径的 recharge
        expiring: balance.expiring.map((lot) => ({
          credits: lot.credits,
          expires_at: lot.expiresAt,
          source: lot.source,
        })),
      });
    } catch (error) {
      throw toBillingError(error, "余额查询暂不可用");
    }
  }
}
