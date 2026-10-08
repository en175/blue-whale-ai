import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { parsePageParam, parsePageSizeParam } from "@lib/shared/account/admin-paging.js";
import { BillingAdminConfigError, BillingAdminError, listAdminTransactions } from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";

@Controller("admin/consumption-records")
@UseGuards(AdminGuard)
export class AdminConsumptionRecordsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const typeFilter = query.type?.trim() ?? "";

    const keyword = (query.keyword ?? query.userId ?? "").trim();

    let userId: number | undefined;
    if (keyword) {
      userId = await this.identity.findAdminUserIdByKeyword(keyword);
      if (userId === undefined) {
        return { success: true, data: { items: [], total: 0 } };
      }
    }

    try {
      const page = await listAdminTransactions({
        ...(userId !== undefined ? { userId } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        pageSize: parsePageSizeParam(query.pageSize),
        page: parsePageParam(query.page),
      });

      const summaries = await this.jobs.loadTaskSummaries(
        page.items
          .map((item) => item.generationJobId)
          .filter((id): id is string => id != null),
      );

      const identities = await this.identity.loadAdminUserIdentities(
        page.items.map((item) => item.userId),
      );

      return {
        success: true,
        data: {
          items: page.items.map((item) => {
            const summary =
              item.generationJobId == null ? undefined : summaries.get(item.generationJobId);
            return {
              id: item.id,
              user_id: item.userId,
              nickname: identities.get(item.userId)?.nickname || null,
              phone: identities.get(item.userId)?.phone || null,
              type: item.type,
              direction: item.direction,
              title: item.title,
              credits: item.amount,
              reserved_credits: item.reservedCredits ?? null,
              task_type: summary?.type ?? null,
              model_id: summary?.modelId ?? null,
              model_label: summary?.modelLabel ?? null,
              prompt: summary?.prompt ?? null,
              status: item.status,
              created_at: item.createdAt,
              settled_at: item.settledAt,
            };
          }),
          total: page.total,
        },
      };
    } catch (error) {
      throw toConsumptionError(error);
    }
  }
}

function toConsumptionError(error: unknown): AdminException {
  if (error instanceof AdminException) return error;
  if (error instanceof BillingAdminConfigError) {
    return new AdminException(503, `积分记录不可用：${error.message}`);
  }
  const detail = error instanceof BillingAdminError ? error.message : "未知错误";
  return new AdminException(502, `积分记录查询失败：${detail}`);
}
