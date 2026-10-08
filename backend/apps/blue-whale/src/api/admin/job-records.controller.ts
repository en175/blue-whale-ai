import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  parsePageParam,
  parsePageSizeParam,
} from "@lib/shared/account/admin-paging.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";

const BIGINT_ID_RE = /^[1-9]\d{0,18}$/;

@Controller("admin/job-records")
@UseGuards(AdminGuard)
export class AdminJobRecordsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly identity: IdentityService,
  ) {}

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

    const projectId = query.projectId?.trim();
    if (projectId) {
      if (!BIGINT_ID_RE.test(projectId)) {
        throw new AdminException(400, "projectId 须为正整数");
      }
      filter.projectId = projectId;
    }

    const type = query.type?.trim();
    if (type) filter.type = type;
    const status = query.status?.trim();
    if (status) filter.status = status;

    const keyword = (query.keyword ?? query.userId ?? "").trim();
    if (keyword) {
      const resolved = await this.identity.findAdminUserIdByKeyword(keyword);
      if (resolved === undefined) {
        return { success: true, data: { list: [], total: 0 } };
      }
      filter.userId = String(resolved);
    }

    try {
      const page = await this.jobs.listForAdmin(filter);

      const identities = await this.identity.loadAdminUserIdentities(
        page.records.map((record) => Number(record.user_id)),
      );

      return {
        success: true,
        data: {
          list: page.records.map((record) => {
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
