import {
  Body,
  Controller,
  Delete,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import { OperationLogService } from "@lib/shared/operation-log/operation-log.service.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";

@Controller("admin/assets")
@UseGuards(AdminGuard)
export class AdminAssetsController {
  constructor(
    private readonly assets: AssetService,
    private readonly operationLog: OperationLogService,
  ) {}

  @Post("hard-delete")
  async hardDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { ids?: unknown },
  ) {
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : [];
    if (ids.length === 0) throw new AdminException(400, "ids 必填");

    const result = await this.assets.adminHardDelete(ids);

    try {
      await this.operationLog.create({
        category: "asset",
        action: "hard-delete",
        target: `资产批量删除（${result.requested} 个）`,
        detail: JSON.stringify({
          requested: result.requested,
          deleted: result.deleted,
          blocked: result.blocked,
          failed: result.failed,
        }),
        operator: user.username,
        operatorId: user.userId,
      });
    } catch (error) {
      logger.error(
        `asset hard-delete audit write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return {
      success: true,
      data: result,
    };
  }
}
