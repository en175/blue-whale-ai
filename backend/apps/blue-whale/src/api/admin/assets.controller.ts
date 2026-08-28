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

/** IKBMDM：管理后台资产物理删除（引用核对 + 审计，支持单删/批量）。 */
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
      // 强删属安全关键写操作：审计失败不静默吞掉，至少上报日志。
      // 【有意偏离 ADR-0018 §7 fail-closed】与全库 admin 端点一致（models/topup-tiers/orders
      // 均为 best-effort 审计），审计写失败仅告警不阻断业务——资产删除不在 ADR §7 强制清单，
      // 且硬删链路本身在 DB 事务内，审计表单独不可用的概率极低（2026-08-28 IKBMDM 评审确认）。
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
