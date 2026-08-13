import { Controller, Get, Param, Query } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, string> = {},
  ) {
    const rawIds = query.ids;
    const ids =
      rawIds === undefined ? undefined : rawIds.split(",").map((id) => id.trim());
    return this.jobs.list(user.userId, {
      type: query.type || undefined,
      status: query.status || undefined,
      projectId: query.projectId || undefined,
      ids,
      page: Math.max(1, Number(query.page ?? "1") || 1),
      size: Math.max(1, Number(query.size ?? "20") || 20),
    });
  }

  @Get(":id")
  async getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.jobs.getStatus(user.userId, id);
  }
}
