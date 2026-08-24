import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { SkillAdminService } from "@lib/shared/skills/skill-admin.service.js";

const CATEGORY_MAX = 32;

function parseBigId(value: string): bigint | null {
  if (!/^\d{1,19}$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/** IKA64P 后续校准：官方技能分类后台管理（用户侧分类展示已隐藏）。
 *  路由注意：categories/rename 必须先于 :id/category 声明。 */
@Controller("admin/skills")
@UseGuards(AdminGuard)
export class AdminSkillsController {
  constructor(private readonly skillAdmin: SkillAdminService) {}

  @Get()
  async list() {
    try {
      return { success: true, data: await this.skillAdmin.listOfficialSkills() };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Get("categories")
  async categories() {
    try {
      return { success: true, data: await this.skillAdmin.listCategories() };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put("categories/rename")
  async rename(@Body() body: Record<string, unknown>) {
    const from = typeof body.from === "string" ? body.from.trim() : "";
    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!from || !to || to.length > CATEGORY_MAX) {
      throw new AdminException(400, `分类名须为 1–${CATEGORY_MAX} 字符`);
    }
    try {
      const count = await this.skillAdmin.renameCategory(from, to);
      return { success: true, data: { count } };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Delete("categories/:name")
  async removeCategory(@Param("name") name: string) {
    try {
      const count = await this.skillAdmin.clearCategory(decodeURIComponent(name));
      return { success: true, data: { count } };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put(":id/category")
  async setCategory(
    @Param("id") idRaw: string,
    @Body() body: Record<string, unknown>,
  ) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    const category =
      typeof body.category === "string" ? body.category.trim() : "";
    if (!category || category.length > CATEGORY_MAX) {
      throw new AdminException(400, `分类名须为 1–${CATEGORY_MAX} 字符`);
    }
    try {
      const ok = await this.skillAdmin.setCategory(id, category);
      if (!ok) throw new AdminException(404, "技能不存在");
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
