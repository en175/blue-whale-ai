import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import {
  HomepageHeroLimitError,
  type CreateHomepageHeroInput,
} from "@blue-whale/persistence";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { HomepageHeroAuditService } from "@lib/shared/homepage-hero/homepage-hero-audit.service.js";
import { HomepageHeroService } from "@lib/shared/homepage-hero/homepage-hero.service.js";
import {
  handleCompleteHomepageHeroUpload,
  handlePresignHomepageHeroUpload,
  type CompleteHomepageHeroUploadInput,
  type PresignHomepageHeroUploadInput,
} from "@lib/shared/homepage-hero/homepage-hero-upload.js";
import {
  parseBigId,
  parseHomepageHeroForm,
  parseMoveDirection,
  type HomepageHeroForm,
} from "@lib/shared/homepage-hero/homepage-hero-validation.js";

/**
 * 首页背景图/视频后台动态配置管理端（IKCH05，接口对齐母工单 IKCH01 草稿）。
 * 路径前缀 api/admin/site-config/homepage-heroes。
 */

@Controller("admin/site-config/homepage-heroes")
@UseGuards(AdminGuard)
export class AdminHomepageHeroesController {
  constructor(
    private readonly hero: HomepageHeroService,
    private readonly heroAudit: HomepageHeroAuditService,
    private readonly storage: AssetStorageService,
  ) {}

  @Get()
  async list() {
    try {
      const items = await this.hero.listAll();
      return { success: true, data: items };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const parsed = parseHomepageHeroForm(body ?? {});
    if (!parsed.ok) throw new AdminException(400, parsed.error);
    try {
      const id = await this.hero.create(parsed.input);
      await this.heroAudit.logCreate(`#${id}`, parsed.input.media_type);
      return { success: true, data: { id } };
    } catch (error) {
      if (error instanceof HomepageHeroLimitError) {
        throw new AdminException(409, error.message);
      }
      throw toAdminError(error);
    }
  }

  @Patch(":id")
  async update(
    @Param("id") idRaw: string,
    @Body() body: Record<string, unknown>,
  ) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    try {
      const before = await this.hero.getById(id);
      if (!before) throw new AdminException(404, "配置不存在");
      // 合并补丁字段到现存条目形成完整表单：跨字段规则（视频必须有封面）在合并后仍成立
      const merged: HomepageHeroForm = {
        media_type: body.media_type ?? before.media_type,
        media_url: body.media_url ?? before.media_url,
        poster_url:
          body.poster_url !== undefined ? body.poster_url : before.poster_url,
        sort_order: body.sort_order ?? before.sort_order,
        enabled: body.enabled ?? before.enabled,
      };
      const parsed = parseHomepageHeroForm(merged);
      if (!parsed.ok) throw new AdminException(400, parsed.error);
      const updated = await this.hero.update(id, parsed.input);
      if (!updated) throw new AdminException(404, "配置不存在");
      await this.heroAudit.logUpdate(
        `#${idRaw}`,
        diffFields(before, parsed.input),
      );
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof HomepageHeroLimitError) {
        throw new AdminException(409, error.message);
      }
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Delete(":id")
  async remove(@Param("id") idRaw: string) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    try {
      const before = await this.hero.getById(id);
      if (!before) throw new AdminException(404, "配置不存在");
      const deleted = await this.hero.softDelete(id);
      if (!deleted) throw new AdminException(404, "配置不存在");
      await this.heroAudit.logDelete(`#${idRaw}`);
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Put(":id/sort")
  async sort(@Param("id") idRaw: string, @Body() body: { direction?: unknown }) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    const direction = parseMoveDirection(body?.direction);
    if (!direction) throw new AdminException(400, "direction 须为 up/down");
    try {
      const target = await this.hero.getById(id);
      if (!target) throw new AdminException(404, "配置不存在");
      const result = await this.hero.move(id, direction);
      if (!result.ok) {
        throw new AdminException(
          result.reason === "boundary" ? 409 : 404,
          result.reason === "boundary" ? "已在边缘" : "配置不存在",
        );
      }
      await this.heroAudit.logMove(`#${idRaw}`, direction);
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Post("uploads/presign")
  async presignUpload(@Body() body: PresignHomepageHeroUploadInput) {
    const result = await handlePresignHomepageHeroUpload(
      body,
      this.storage.uploads,
    );
    if (!result.ok) {
      throw new AdminException(
        result.error === "对象存储未配置" ? 503 : 400,
        result.error,
      );
    }
    return { success: true, data: result.data };
  }

  @Post("uploads/complete")
  async completeUpload(@Body() body: CompleteHomepageHeroUploadInput) {
    const result = await handleCompleteHomepageHeroUpload(body, {
      storage: this.storage.uploads,
      audit: this.heroAudit,
    });
    if (!result.ok) {
      throw new AdminException(
        result.error === "对象存储未配置" ? 503 : 400,
        result.error,
      );
    }
    return { success: true, data: result.data };
  }
}

/** 编辑审计：对比 before/after 输出变更字段名（与模板 diffFields 同款）。 */
function diffFields(
  before: { media_type: string; media_url: string; poster_url: string | null; sort_order: number; enabled: number },
  after: CreateHomepageHeroInput,
): string[] {
  const changed: string[] = [];
  if (before.media_type !== after.media_type) changed.push("媒体类型");
  if (before.media_url !== after.media_url) changed.push("媒体地址");
  if ((before.poster_url ?? "") !== (after.poster_url ?? "")) changed.push("封面");
  if (before.sort_order !== after.sort_order) changed.push("排序");
  if (before.enabled !== (after.enabled ?? before.enabled)) changed.push("启用状态");
  return changed;
}
