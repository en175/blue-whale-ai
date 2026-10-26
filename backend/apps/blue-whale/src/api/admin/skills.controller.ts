import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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

  @Post("backfill")
  async backfill() {
    try {
      const created = await this.skillAdmin.backfillOfficialAssets();
      return { success: true, data: { created } };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put("assign")
  async assign(@Body() body: Record<string, unknown>) {
    const category =
      typeof body.category === "string" ? body.category.trim() : "";
    if (!category || category.length > CATEGORY_MAX) {
      throw new AdminException(400, `分类名须为 1–${CATEGORY_MAX} 字符`);
    }
    const idsRaw = Array.isArray(body.ids) ? body.ids : [];
    const ids: bigint[] = [];
    for (const v of idsRaw) {
      const id = typeof v === "string" ? parseBigId(v) : null;
      if (!id) throw new AdminException(400, "ids 含无效 id");
      ids.push(id);
    }
    if (ids.length === 0) throw new AdminException(400, "ids 不能为空");
    try {
      const count = await this.skillAdmin.assignCategory(ids, category);
      return { success: true, data: { count } };
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
