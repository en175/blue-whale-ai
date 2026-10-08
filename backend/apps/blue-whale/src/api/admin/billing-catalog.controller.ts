import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  BillingAdminConfigError,
  BillingAdminError,
  CatalogRejectedError,
  fetchActiveCatalog,
  publishCatalog,
} from "@lib/shared/billing/billing-admin-client.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("admin/billing-catalog")
@UseGuards(AdminGuard)
export class AdminBillingCatalogController {
  @Get()
  async active() {
    try {
      return { success: true, data: await fetchActiveCatalog() };
    } catch (error) {
      throw this.toAdminError(error);
    }
  }

  @Post()
  async publish(
    @CurrentUser() operator: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    const document = typeof body.document === "string" ? body.document : "";
    if (!document.trim()) {
      throw new AdminException(400, "document 必填：请提交目录 JSON 文本");
    }
    const note = typeof body.note === "string" ? body.note.trim() : "";

    try {
      return {
        success: true,
        data: await publishCatalog({
          document,
          publishedBy: String(operator.userId),
          ...(note ? { note } : {}),
        }),
      };
    } catch (error) {
      throw this.toAdminError(error);
    }
  }

  private toAdminError(error: unknown): AdminException {
    if (error instanceof AdminException) return error;
    if (error instanceof CatalogRejectedError) return new AdminException(400, error.message);
    if (error instanceof BillingAdminConfigError || error instanceof BillingAdminError) {
      return new AdminException(503, error.message);
    }
    return new AdminException(500, error instanceof Error ? error.message : "未知错误");
  }
}
