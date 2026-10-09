import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
} from "@lib/shared/billing/billing-admin-client.js";
import { parseId, parsePromotionInput, toDiscountAdminError } from "@lib/shared/billing/discount-input.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

@Controller("admin/billing-promotions")
@UseGuards(AdminGuard)
export class AdminBillingPromotionsController {
  @Get()
  async list(@Query("status") status?: string) {
    const query: { status?: string } = {};
    if (status) query.status = status;
    try {
      return { success: true, data: await listPromotions(query) };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Post()
  async create(
    @CurrentUser() operator: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
  ) {
    try {
      return {
        success: true,
        data: await createPromotion(parsePromotionInput(body), String(operator.userId)),
      };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return {
        success: true,
        data: await updatePromotion(parseId(id), parsePromotionInput(body)),
      };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    try {
      await deletePromotion(parseId(id));
      return { success: true, data: { deleted: true } };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }
}
