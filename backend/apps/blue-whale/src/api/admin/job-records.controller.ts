import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";

/** BigInt 列入参守卫：仅十进制正整数串（与 admin.controller 同一口径）。 */
const BIGINT_ID_RE = /^[1-9]\d{0,18}$/;

/**
 * 任务记录（管理端）。
 *
 * <p>数据源是我们自己的 `generation_jobs`——任务的**执行**状态（排队 / 跑 / 成功 / 失败、
 * 进度、重试次数、失败原因）。与用户端的 `GET /api/jobs` 同一张表，差别只有一条：
 * 那条按登录用户强制过滤（`JobsService.list`），这条可以不过滤（管理端要看全站）。
 *
 * <p>⚠️ 这一页**不是**账单。任务 ≠ 消费：任务可能失败全额返还（用户净变化 0，
 *    账本里不会出现一行消费），也可能一个任务对应多次扣费。要看钱去积分记录页。
 */
@Controller("admin/job-records")
@UseGuards(AdminGuard)
export class AdminJobRecordsController {
  constructor(private readonly jobs: JobsService) {}

  /**
   * GET /api/admin/job-records?page=&pageSize=&userId=&projectId=&type=&status=
   *
   * <p>全部筛选条件可选：都不传 = 全站最近一批任务。
   */
  @Get()
  async list(@Query() query: Record<string, string> = {}) {
    const filter: {
      page: number;
      size: number;
      userId?: string;
      projectId?: string;
      type?: string;
      status?: string;
    } = {
      page: parsePageParam(query.page),
      size: parsePageSizeParam(query.pageSize),
    };

    for (const field of ["userId", "projectId"] as const) {
      const raw = query[field]?.trim();
      if (!raw) continue;
      if (!BIGINT_ID_RE.test(raw)) {
        throw new AdminException(400, `${field} 须为正整数`);
      }
      filter[field] = raw;
    }

    // type / status 是自由文本（任务类型与状态都在演进，写死白名单会在新增类型时误伤），
    // 查不到就是空列表——这里与 status 枚举固定的订单页不同，那边写死是安全的。
    const type = query.type?.trim();
    if (type) filter.type = type;
    const status = query.status?.trim();
    if (status) filter.status = status;

    try {
      const page = await this.jobs.listForAdmin(filter);
      return { success: true, data: { list: page.records, total: page.total } };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}
