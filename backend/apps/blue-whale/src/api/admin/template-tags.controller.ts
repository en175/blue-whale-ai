import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { TemplateAdminService } from "@lib/shared/template/template-admin.service.js";
import { TemplateAuditService } from "@lib/shared/template/template-audit.service.js";
import { TemplateService } from "@lib/shared/template/template.service.js";

const LABEL_MAX = 128;

@Controller("admin/template-tags")
@UseGuards(AdminGuard)
export class AdminTemplateTagsController {
  constructor(
    private readonly template: TemplateService,
    private readonly templateAdmin: TemplateAdminService,
    private readonly templateAudit: TemplateAuditService,
  ) {}

  @Get()
  async list() {
    try {
      const tags = await this.template.listAllTags();
      return { success: true, data: tags };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Put()
  async rename(@Body() body: Record<string, unknown>) {
    const tagCode = typeof body.tag_code === "string" ? body.tag_code.trim() : "";
    if (tagCode === "") throw new AdminException(400, "tag_code 必填");
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (label === "") throw new AdminException(400, "标签名称必填");
    if (label.length > LABEL_MAX) {
      throw new AdminException(400, `标签名称长度不得超过 ${LABEL_MAX}`);
    }
    try {
      const before = await this.template.listTags();
      const old = before.find((t) => t.tag_code === tagCode);
      if (!old) throw new AdminException(404, "标签不存在");
      const renamed = await this.templateAdmin.renameTag(tagCode, label);
      if (!renamed) throw new AdminException(404, "标签不存在");
      await this.templateAudit.logTagRename(tagCode, old.label, label);
      return { success: true, data: { tag_code: tagCode } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  /** IKA64P：标签隐藏开关（首页即时生效） */
  @Put("visibility")
  async setVisibility(@Body() body: Record<string, unknown>) {
    const tagCode = typeof body.tag_code === "string" ? body.tag_code.trim() : "";
    if (tagCode === "") throw new AdminException(400, "tag_code 必填");
    const visible =
      body.visible === 1 || body.visible === true
        ? 1
        : body.visible === 0 || body.visible === false
          ? 0
          : null;
    if (visible === null) throw new AdminException(400, "visible 须为 0/1");
    try {
      const changed = await this.templateAdmin.setTagVisibility(tagCode, visible);
      if (!changed) throw new AdminException(404, "标签不存在");
      await this.templateAudit.logTagVisibility(tagCode, visible);
      return { success: true, data: { tag_code: tagCode, visible } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
