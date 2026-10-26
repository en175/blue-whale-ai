import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import {
  createMemberDiscount,
  deleteMemberDiscount,
  listMemberDiscounts,
  updateMemberDiscount,
} from "@lib/shared/billing/billing-admin-client.js";
import { parseId, parseMemberDiscountInput, toDiscountAdminError } from "@lib/shared/billing/discount-input.js";
import { AdminException } from "@lib/shared/errors/admin-error.js";

@Controller("admin/billing-discounts")
@UseGuards(AdminGuard)
export class AdminBillingDiscountsController {
  @Get()
  async list(@Query("tier") tier?: string, @Query("status") status?: string) {
    const query: { tier?: string; status?: string } = {};
    if (tier) query.tier = tier;
    if (status) query.status = status;
    try {
      return { success: true, data: await listMemberDiscounts(query) };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>) {
    try {
      return { success: true, data: await createMemberDiscount(parseMemberDiscountInput(body)) };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Put(":id")
  async update(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    try {
      return {
        success: true,
        data: await updateMemberDiscount(parseId(id), parseMemberDiscountInput(body)),
      };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    try {
      await deleteMemberDiscount(parseId(id));
      return { success: true, data: { deleted: true } };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }
}
