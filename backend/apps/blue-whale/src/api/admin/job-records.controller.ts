import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
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
 *
 * <p><b>用户维度的筛选与展示</b>：`generation_jobs` 里只有 `user_id`，认不出人。所以
 * 「按手机号 / 昵称查」与列表上的昵称 / 手机号都走我们自己的 `bw_users`——
 * 先精确解成一个 userId 再过滤，行上的身份按本页的 user_id 集合批量回填。
 * 与积分记录页同一套口径（那边受 billing 跨库限制，必须这么绕；这边是顺手对齐）。
 */
@Controller("admin/job-records")
@UseGuards(AdminGuard)
export class AdminJobRecordsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * GET /api/admin/job-records?page=&pageSize=&keyword=&projectId=&type=&status=
   *
   * @param keyword 用户 ID / 手机号 / 昵称，**都要完整**（精确匹配）。空 = 全部用户
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

    // ⚠️ 还认着旧的 `userId`。前端与后端不是原子发版（本仓 2026-09-26 实测过 3100 上
    //    跑着 4 小时前的构建），一个还没刷新的管理页仍会发 `?userId=42`。不认它的后果
    //    不是报错，而是**静默回一页全站任务**——运营以为筛了那个人，实际看到所有人的任务。
    const keyword = (query.keyword ?? query.userId ?? "").trim();
    if (keyword) {
      const resolved = await this.identity.findAdminUserIdByKeyword(keyword);
      // 认不出这个人就回空页，不去查任务表：这一页的筛选语义是「找某个人」，
      // 而「查无此人」与「这个人没有任务」在界面上同形，是**接受的**（空态文案保持中性）。
      if (resolved === undefined) {
        return { success: true, data: { list: [], total: 0 } };
      }
      // `listForAdmin` 的 user_id 走 bigint 字符串口径（超出 JS 安全整数也不丢精度）
      filter.userId = String(resolved);
    }

    const projectId = query.projectId?.trim();
    if (projectId) {
      if (!BIGINT_ID_RE.test(projectId)) {
        throw new AdminException(400, "projectId 须为正整数");
      }
      filter.projectId = projectId;
    }

    // type / status 是自由文本（任务类型与状态都在演进，写死白名单会在新增类型时误伤），
    // 查不到就是空列表——这里与 status 枚举固定的订单页不同，那边写死是安全的。
    const type = query.type?.trim();
    if (type) filter.type = type;
    const status = query.status?.trim();
    if (status) filter.status = status;

    try {
      const page = await this.jobs.listForAdmin(filter);

      // 昵称 / 手机号：**一次 IN 查回来**，不逐行查。与积分记录页同一个套路。
      const identities = await this.identity.loadAdminUserIdentities(
        page.records.map((record) => Number(record.user_id)),
      );

      return {
        success: true,
        data: {
          list: page.records.map((record) => {
            // ⚠️ `|| null` 而不是 `?? null`：身份里用空串表示「没有」（存量用户没手机号是常态），
            //    落到对外契约里收敛成**唯一的**一种「没有」。用户查不到时整个 identity 缺席，
            //    同样落到 null。两种合计一种，前端只需判一次。
            const identity = identities.get(Number(record.user_id));
            return {
              ...record,
              nickname: identity?.nickname || null,
              phone: identity?.phone || null,
            };
          }),
          total: page.total,
        },
      };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}
