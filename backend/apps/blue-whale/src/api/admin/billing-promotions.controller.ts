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

/**
 * 营销活动（`billing_promotions`）的管理端入口。
 *
 * <p>转发 billing 的 `/admin/promotions`（内网、**无鉴权**），由这条过了 {@link AdminGuard}
 * 的路由代打。与会员折扣同一条冻结语义：提交时冻结命中的系数，改活动不影响已提交任务。
 *
 * <h2>为什么 created_by 由这里带过去</h2>
 *
 * <p>billing 的管理面没有鉴权，它不知道请求是谁发的。而「这条活动是谁建的」是事后
 * 排查第一个要问的问题（谁把 7 折配成了 0.7？）。所以建活动时把当前管理员的 userId
 * 作为 `operator` 传过去 —— 与目录发布带 `publishedBy` 同一手法。
 * ⚠️ 只有创建带：`created_by` 是「谁建的」，不是「谁最后改的」（后者要留痕得另加列）。
 */
@Controller("admin/billing-promotions")
@UseGuards(AdminGuard)
export class AdminBillingPromotionsController {
  /**
   * GET /api/admin/billing-promotions
   *
   * @param status draft | enabled | disabled | expired；省略 = 全部。
   *               ⚠️ 不能按「此刻是否命中」过滤：那要按活动自己的时区算时段与星期，
   *               是计价侧的逻辑，在管理端复刻一份必然与实际命中漂移
   */
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

  /**
   * POST /api/admin/billing-promotions
   *
   * <p>billing 侧默认建出来是 `draft`：**先建好、确认无误再启用**。
   * 界面上「启用」是列表里的一个动作，不是建表单里的一个必选值。
   */
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

  /** PUT /api/admin/billing-promotions/:id —— **整条覆盖**；`null` 是「不限 / 全天」这个状态。 */
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

  /** DELETE /api/admin/billing-promotions/:id —— 物理删除（想留一手就先停用）。 */
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
