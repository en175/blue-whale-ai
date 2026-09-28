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

/**
 * 会员等级折扣（`billing_member_discounts`）的管理端入口。
 *
 * <p>它转发 billing 的管理端 HTTP 面（`/admin/member-discounts`）—— 那个端口只在内网、
 * **没有鉴权**，所以页面不能直连，必须由这条过了 {@link AdminGuard} 的路由代打。
 * 与 `AdminBillingCatalogController` 同一立场：这不是「多一层」，是把唯一对外开放的那道门放对位置。
 *
 * <h2>这张表没有「发布」动作</h2>
 *
 * <p>与定价目录相反：目录是「一个版本 = 一份 JSON，整份发布、整份回滚」，
 * 而折扣是 **live 表**——保存即生效，下次预扣就会命中。所以这里是普通的 CRUD，
 * 不是「读回来改一改再整份发布」。两条链路的分界在于**是否影响已提交任务**：
 * 目录用版本边界冻结，折扣用「预扣时把命中的系数冻进预留行」冻结（见 billing 侧的注释）。
 *
 * <p>因此界面上必须写清那条冻结语义：**改折扣不影响已提交未结算的任务**。
 * 运营改了折扣却发现某笔还按老的算时，唯一能让他不误判的提示就在这里。
 */
@Controller("admin/billing-discounts")
@UseGuards(AdminGuard)
export class AdminBillingDiscountsController {
  /**
   * GET /api/admin/billing-discounts
   *
   * @param tier   按等级过滤（free | basic | pro | max）；省略 = 全部
   * @param status 按状态过滤（enabled | disabled）；省略 = 全部。
   *               ⚠️ 停用的也一并返回（billing 侧如此）：藏掉它们，运营会以为已经删了，
   *               然后重新配一条一模一样的
   */
  @Get()
  async list(@Query("tier") tier?: string, @Query("status") status?: string) {
    // ⚠️ 条件式赋值而不是 `{ tier, status }`：exactOptionalPropertyTypes 下
    //    「显式传 undefined」与「不传」是两件事，后者才是「不过滤」
    const query: { tier?: string; status?: string } = {};
    if (tier) query.tier = tier;
    if (status) query.status = status;
    try {
      return { success: true, data: await listMemberDiscounts(query) };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  /** POST /api/admin/billing-discounts（保存即生效，没有发布动作）。 */
  @Post()
  async create(@Body() body: Record<string, unknown>) {
    try {
      return { success: true, data: await createMemberDiscount(parseMemberDiscountInput(body)) };
    } catch (error) {
      throw toDiscountAdminError(error);
    }
  }

  /**
   * PUT /api/admin/billing-discounts/:id —— **整条覆盖**（不是部分更新）。
   *
   * <p>界面上编辑一条就是「把这一行重新提交一次」，没有「只改一个字段」的接口：
   * 局部更新在这里会引入第二种语义（没给的字段保持原值），而它和「清空」长得一模一样。
   */
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

  /** DELETE /api/admin/billing-discounts/:id —— 物理删除（想留一手就改成停用）。 */
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
