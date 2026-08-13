import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import { toAdminError } from "@lib/shared/errors/admin-error.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** BigInt 列入参守卫：仅十进制正整数串。 */
const BIGINT_ID_RE = /^\d{1,19}$/;

const FIELD_LIMITS = {
  category: 32,
  action: 64,
  target: 255,
  operator: 64,
  ipAddress: 64,
} as const;

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly operationLog: OperationLogService) {}

  @Get("session")
  session(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: { userId: user.userId, isAdmin: user.isAdmin } };
  }

  @Get("operation-logs")
  async listOperationLogs(@Query() query: Record<string, string> = {}) {
    try {
      const filter: {
        category?: string;
        searchText?: string;
        from?: Date;
        to?: Date;
      } = {};
      if (query.category) filter.category = query.category;
      if (query.searchText) filter.searchText = query.searchText;
      if (query.dateFrom) filter.from = new Date(query.dateFrom);
      if (query.dateTo) {
        filter.to = new Date(new Date(query.dateTo).getTime() + 86_400_000);
      }
      const rows = await this.operationLog.list(filter);
      return { success: true, data: rows };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post("operation-logs")
  async createOperationLog(@Body() body: Record<string, unknown>) {
    const category = body.category;
    const action = body.action;
    if (!category || typeof category !== "string") {
      throw toAdminError(new Error("category 必填"));
    }
    if (!action || typeof action !== "string") {
      throw toAdminError(new Error("action 必填"));
    }
    for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
      const value = body[field];
      if (typeof value === "string" && value.length > limit) {
        throw toAdminError(new Error(`${field} 长度不得超过 ${limit}`));
      }
    }
    for (const field of ["targetUserId", "operatorId"] as const) {
      const value = body[field];
      if (value != null && !BIGINT_ID_RE.test(String(value))) {
        throw toAdminError(new Error(`${field} 须为正整数`));
      }
    }
    try {
      const row = await this.operationLog.create({
        category,
        action,
        target: typeof body.target === "string" ? body.target : "",
        targetUserId:
          body.targetUserId != null ? String(body.targetUserId) : null,
        detail: typeof body.detail === "string" ? body.detail : "",
        operator: typeof body.operator === "string" ? body.operator : "",
        operatorId: body.operatorId != null ? String(body.operatorId) : null,
        ipAddress:
          typeof body.ipAddress === "string" ? body.ipAddress : null,
      });
      return { success: true, data: row };
    } catch (error) {
      throw toAdminError(error);
    }
  }
}
