import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  TemplateAdminInputError,
  type AdminTemplateCardView,
  type TemplateCardInput,
} from "@blue-whale/persistence";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { TemplateAdminService } from "@lib/shared/template/template-admin.service.js";
import { TemplateAuditService } from "@lib/shared/template/template-audit.service.js";
import { TemplateService } from "@lib/shared/template/template.service.js";
import {
  handleCompleteTemplateUpload,
  handlePresignTemplateUpload,
  type CompleteTemplateUploadInput,
  type PresignTemplateUploadInput,
} from "@lib/shared/template/template-upload.js";
import {
  listAllTemplateTags,
  parseBigId,
  parseMoveDirection,
  parseTemplateCardForm,
} from "@lib/shared/template/template-validation.js";

function diffFields(
  before: AdminTemplateCardView,
  after: TemplateCardInput,
): string[] {
  const changed: string[] = [];
  if (before.title !== after.title) changed.push("标题");
  if (before.tag_code !== after.tag_code) changed.push("标签");
  if (before.layout !== after.layout) changed.push("layout");
  if (before.sort_order !== after.sort_order) changed.push("排序");
  if ((before.video_url ?? "") !== (after.video_url ?? "")) changed.push("视频");
  if ((before.content ?? "") !== (after.content ?? "")) changed.push("提示词");
  const beforeImgs = before.images.map((i) => i.image_url).join("|");
  const afterImgs = after.images.map((i) => i.image_url).join("|");
  if (beforeImgs !== afterImgs) changed.push("图片");
  return changed;
}

@Controller("admin/templates")
@UseGuards(AdminGuard)
export class AdminTemplatesController {
  constructor(
    private readonly template: TemplateService,
    private readonly templateAdmin: TemplateAdminService,
    private readonly templateAudit: TemplateAuditService,
    private readonly storage: AssetStorageService,
  ) {}

  @Get()
  async list(@Query("tagCode") tagCode?: string) {
    try {
      const cards = await this.templateAdmin.listCards(tagCode || undefined);
      return { success: true, data: cards };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const tags = await this.template.listAllTags();
    const validTagCodes = new Set(
      (tags.length > 0 ? tags : listAllTemplateTags()).map((t) => t.tag_code),
    );
    const parsed = parseTemplateCardForm(body ?? {}, validTagCodes);
    if (!parsed.ok) throw new AdminException(400, parsed.error);
    try {
      const id = await this.templateAdmin.createCard(parsed.input);
      await this.templateAudit.logCreate(parsed.input.title, parsed.input.tag_code);
      return { success: true, data: { id } };
    } catch (error) {
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
    try {
      const before = await this.templateAdmin.getCard(id);
      if (!before) throw new AdminException(404, "卡片不存在");
      const tags = await this.template.listAllTags();
      const validTagCodes = new Set(
        (tags.length > 0 ? tags : listAllTemplateTags()).map((t) => t.tag_code),
      );
      const parsed = parseTemplateCardForm(body ?? {}, validTagCodes);
      if (!parsed.ok) throw new AdminException(400, parsed.error);
      const updated = await this.templateAdmin.updateCard(id, parsed.input);
      if (!updated) throw new AdminException(404, "卡片不存在");
      await this.templateAudit.logUpdate(
        parsed.input.title,
        diffFields(before, parsed.input),
      );
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof TemplateAdminInputError) {
        throw new AdminException(400, error.message);
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
      const before = await this.templateAdmin.getCard(id);
      if (!before) throw new AdminException(404, "卡片不存在");
      const deleted = await this.templateAdmin.softDeleteCard(id);
      if (!deleted) throw new AdminException(404, "卡片不存在");
      await this.templateAudit.logDelete(before.title);
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Post("uploads/presign")
  async presignUpload(@Body() body: PresignTemplateUploadInput) {
    const result = await handlePresignTemplateUpload(body, this.storage.uploads);
    if (!result.ok) {
      throw new AdminException(
        result.error === "对象存储未配置" ? 503 : 400,
        result.error,
      );
    }
    return { success: true, data: result.data };
  }

  @Post("uploads/complete")
  async completeUpload(@Body() body: CompleteTemplateUploadInput) {
    const result = await handleCompleteTemplateUpload(body, {
      storage: this.storage.uploads,
      audit: this.templateAudit,
    });
    if (!result.ok) {
      throw new AdminException(
        result.error === "对象存储未配置" ? 503 : 400,
        result.error,
      );
    }
    return { success: true, data: result.data };
  }

  @Post(":id/move")
  async move(
    @Param("id") idRaw: string,
    @Body() body: { direction?: unknown },
  ) {
    const id = parseBigId(idRaw);
    if (!id) throw new AdminException(400, "id 无效");
    const direction = parseMoveDirection(body?.direction);
    if (!direction) throw new AdminException(400, "direction 须为 up/down");
    try {
      const card = await this.templateAdmin.getCard(id);
      if (!card) throw new AdminException(404, "卡片不存在");
      const result = await this.templateAdmin.moveCard(id, direction);
      if (!result.ok) {
        throw new AdminException(
          result.reason === "boundary" ? 409 : 404,
          result.reason === "boundary" ? "已在边缘" : "卡片不存在",
        );
      }
      await this.templateAudit.logMove(card.title, direction);
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
