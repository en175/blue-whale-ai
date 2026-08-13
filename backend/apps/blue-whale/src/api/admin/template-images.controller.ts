import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import { TemplateAdminService } from "@lib/shared/template/template-admin.service.js";
import { TemplateAuditService } from "@lib/shared/template/template-audit.service.js";
import { parseBigId, parseMoveDirection } from "@lib/shared/template/template-validation.js";

@Controller("admin/template-images")
@UseGuards(AdminGuard)
export class AdminTemplateImagesController {
  constructor(
    private readonly templateAdmin: TemplateAdminService,
    private readonly templateAudit: TemplateAuditService,
  ) {}

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
      const result = await this.templateAdmin.moveImage(id, direction);
      if (!result.ok) {
        throw new AdminException(
          result.reason === "boundary" ? 409 : 404,
          result.reason === "boundary" ? "已在边缘" : "图片不存在",
        );
      }
      await this.templateAudit.logImageMove(`图片#${idRaw}`, direction);
      return { success: true, data: { id: idRaw } };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
