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

  @Get(":id")
  async detail(@Param("id") idRaw: string) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    try {
      const data = await this.skillAdmin.getOfficialSkill(id);
      if (!data) throw new AdminException(404, "技能不存在");
      return { success: true, data };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Put(":id")
  async update(
    @Param("id") idRaw: string,
    @Body() body: Record<string, unknown>,
  ) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    const input: {
      name?: string;
      description?: string | null;
      content?: string | null;
      category?: string;
      sort_order?: number;
      cover_url?: string | null;
    } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 255) {
        throw new AdminException(400, "名称须为 1–255 字符");
      }
      input.name = name;
    }
    if (body.category !== undefined) {
      const category =
        typeof body.category === "string" ? body.category.trim() : "";
      if (!category || category.length > CATEGORY_MAX) {
        throw new AdminException(400, `分类名须为 1–${CATEGORY_MAX} 字符`);
      }
      input.category = category;
    }
    if (body.description !== undefined) {
      if (body.description !== null && typeof body.description !== "string") {
        throw new AdminException(400, "简介须为字符串或 null");
      }
      input.description = body.description as string | null;
    }
    if (body.content !== undefined) {
      if (body.content !== null && typeof body.content !== "string") {
        throw new AdminException(400, "正文须为字符串或 null");
      }
      input.content = body.content as string | null;
    }
    if (body.sort_order !== undefined) {
      if (
        typeof body.sort_order !== "number" ||
        !Number.isInteger(body.sort_order)
      ) {
        throw new AdminException(400, "排序须为整数");
      }
      input.sort_order = body.sort_order;
    }
    if (body.cover_url !== undefined) {
      if (body.cover_url !== null && typeof body.cover_url !== "string") {
        throw new AdminException(400, "封面地址须为字符串或 null");
      }
      input.cover_url = body.cover_url as string | null;
    }
    if (Object.keys(input).length === 0) {
      throw new AdminException(400, "没有可更新的字段");
    }
    try {
      const result = await this.skillAdmin.updateOfficialSkill(id, input);
      if (result === "conflict") {
        throw new AdminException(409, "官方技能名称已被占用");
      }
      if (result === "not_found") throw new AdminException(404, "技能不存在");
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Post(":id/active")
  async setActive(
    @Param("id") idRaw: string,
    @Body() body: Record<string, unknown>,
  ) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    if (body.is_delete !== 0 && body.is_delete !== 1) {
      throw new AdminException(400, "is_delete 只能是 0 或 1");
    }
    try {
      const ok = await this.skillAdmin.setActive(id, body.is_delete);
      if (!ok) throw new AdminException(404, "技能不存在");
      return { success: true, data: { id: idRaw, is_delete: body.is_delete } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
