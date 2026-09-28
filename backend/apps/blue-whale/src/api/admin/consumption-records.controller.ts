import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { BillingAdminConfigError, BillingAdminError, listAdminTransactions } from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePageSize(raw: string | undefined): number {
  const size = Number(raw);
  return Number.isInteger(size) && size > 0
    ? Math.min(MAX_PAGE_SIZE, size)
    : DEFAULT_PAGE_SIZE;
}

/**
 * 消费记录（管理端）。
 *
 * <p>数据源是 **billing 的账本**——不是我们的库。判据很简单：钱只从 billing 的
 * 复式账本进出，本地任何一张表都只是它的投影（`recharge_orders` 是充值订单的**订单**，
 * 不是账；`generation_jobs` 是任务的**执行**，不是扣费）。要答「谁在什么时候花了多少」，
 * 唯一权威就是 billing。
 *
 * <p>⚠️ **没有复用用户面那条 gRPC `ListTransactions`**：它的契约里 `user_id` 必填，
 *    语义是「把我的账给我」。管理端要的是「某个人的 / 所有人一起看」——
 *    给**用户面契约**加「userId 可不填」等于给每个持 token 的调用者开了拉全站流水的口子。
 *    所以在 proto 里另开了**独立的一条服务**（`BillingAdminService`），用户面那条一个字没动。
 *    本控制器是它的 BFF。
 *
 * <p>（这段论证曾经用来支持「管理面是 billing 新增的一条 HTTP」。它反驳的是**复用用户面
 *    那条 rpc**，不是「用 gRPC」—— 独立服务同样满足它，还免掉两套协议。2026-09-26 迁到
 *    gRPC 时把这段留在 proto 与这里，防止后来的人照着旧结论回滚。）
 *
 * <p>⚠️ **分页是游标、没有总数**（账本持续追加，要准确总数就得扫全表，而扫完那一刻
 *    它又变了）。所以这里**不返回 total**，前端也只能给「上一页/下一页」。
 *    这与充值记录页的 offset 分页形状不同——但前端用同一个翻页组件，观感一致。
 */
@Controller("admin/consumption-records")
@UseGuards(AdminGuard)
export class AdminConsumptionRecordsController {
  /**
   * GET /api/admin/consumption-records?userId=&type=&pageSize=&pageToken=
   *
   * @param userId 不传 = **全站消费**（管理端独有；用户面没有这个自由度）
   * @param type   单值（consume | recharge | ...），空 = 全部
   */
  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const typeFilter = query.type?.trim() ?? "";

    const rawUserId = query.userId?.trim();
    let userId: number | undefined;
    if (rawUserId) {
      const parsed = Number(rawUserId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AdminException(400, "userId 须为正整数");
      }
      userId = parsed;
    }

    try {
      const page = await listAdminTransactions({
        ...(userId !== undefined ? { userId } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        pageSize: parsePageSize(query.pageSize),
        pageToken: query.pageToken ?? "",
      });
      return {
        success: true,
        data: {
          items: page.items.map((item) => ({
            id: item.id,
            user_id: item.userId,
            type: item.type,
            direction: item.direction,
            title: item.title,
            credits: item.amount,
            // 该行当初冻了多少（**只有消费行有**；发放 / 账本行是 null）。
            // ⚠️ 显式 `?? null` 而不是透传：billing 若哪天不回这个键，前端会拿到
            //    `undefined`，而 `undefined == null` 为真、`undefined !== null` 也为真——
            //    让契约里只有一种「没有」，界面才不需要判两种空。
            reserved_credits: item.reservedCredits ?? null,
            status: item.status,
            created_at: item.createdAt,
            settled_at: item.settledAt,
          })),
          next_page_token: page.nextPageToken,
        },
      };
    } catch (error) {
      throw toConsumptionError(error);
    }
  }
}

/**
 * billing 的两类失败分开报，各自带一个**可判**的状态码。
 *
 * <p>与 `billing-admin-client` 里那两个错误类型同源：**配置错**（地址没配）要人去改配置
 * 并重启——这一次请求再重试也不会好，所以是 503；**调用失败**可能等 billing 恢复就好，
 * 是 502。混成一个 500，值班的人只能靠读文案猜该找谁。
 *
 * <p>⚠️ 两种情况都**不能**回 200 空列表：空列表会让人得出「这段时间没人消费」，
 *    那是一句不报错的假话——而这一页恰恰是用来对账的。
 */
function toConsumptionError(error: unknown): AdminException {
  if (error instanceof AdminException) return error;
  if (error instanceof BillingAdminConfigError) {
    return new AdminException(503, `消费记录不可用：${error.message}`);
  }
  const detail = error instanceof BillingAdminError ? error.message : "未知错误";
  return new AdminException(502, `消费记录查询失败：${detail}`);
}
