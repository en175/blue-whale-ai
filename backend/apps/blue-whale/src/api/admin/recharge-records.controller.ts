import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { AccountDirectoryService } from "@lib/shared/identity/account-directory.service.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { RechargeService } from "@lib/shared/recharge/recharge.service.js";
import {
  RECHARGE_ORDER_STATUS,
  RECHARGE_ORDER_STATUSES,
  type RechargeOrderStatus,
} from "@lib/shared/persistence/index.js";

const STATUSES = RECHARGE_ORDER_STATUSES;

@Controller("admin/recharge-records")
@UseGuards(AdminGuard)
export class AdminRechargeRecordsController {
  constructor(
    private readonly recharge: RechargeService,
    private readonly operationLog: OperationLogService,
    private readonly directory: AccountDirectoryService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const filter: {
      page: number;
      pageSize: number;
      userId?: number;
      status?: RechargeOrderStatus;
      tradeNo?: string;
    } = {
      page: parsePageParam(query.page),
      pageSize: parsePageSizeParam(query.pageSize),
    };

    const status = query.status?.trim();
    if (status) {
      if (!STATUSES.includes(status as RechargeOrderStatus)) {
        throw new AdminException(400, `status 须为 ${STATUSES.join("/")}`);
      }
      filter.status = status as RechargeOrderStatus;
    }

    const keyword = (query.keyword ?? query.userId ?? "").trim();
    if (keyword) {
      const resolved = await this.directory.findAdminUserIdByKeyword(keyword);
      if (resolved === undefined) {
        return { success: true, data: { list: [], total: 0 } };
      }
      filter.userId = resolved;
    }

    const tradeNo = query.tradeNo?.trim();
    if (tradeNo) filter.tradeNo = tradeNo;

    try {
      const { items, total } = await this.recharge.listOrdersForAdmin(filter);

      const identities = await this.directory.loadAdminUserIdentities(
        items.map((item) => Number(item.userId)),
      );

      return {
        success: true,
        data: {
          list: items.map((item) => {
            const identity = identities.get(Number(item.userId));
            return {
              ...item,
              nickname: identity?.nickname || null,
              phone: identity?.phone || null,
            };
          }),
          total,
        },
      };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post(":tradeNo/retry-grant")
  async retryGrant(@Param("tradeNo") tradeNo: string) {
    const id = tradeNo?.trim();
    if (!id) throw new AdminException(400, "缺少交易单号");

    let result: { tradeNo: string; status: RechargeOrderStatus };
    try {
      result = await this.recharge.retryGrantForAdmin(id);
    } catch (error) {
      throw toAdminError(error);
    }
    await this.writeRetryAudit(id, result.status);
    return { success: true, data: result };
  }

  private async writeRetryAudit(
    tradeNo: string,
    status: RechargeOrderStatus,
  ): Promise<void> {
    try {
      await this.operationLog.create({
        category: "recharge",
        action: "重试发放",
        target: tradeNo,
        detail:
          status === RECHARGE_ORDER_STATUS.paid
            ? "人工补发成功，积分已到账"
            : `人工补发后订单仍停在 ${status}（发放仍失败，详见服务端日志）`,
        operator: "admin",
      });
    } catch {
    }
  }
}
