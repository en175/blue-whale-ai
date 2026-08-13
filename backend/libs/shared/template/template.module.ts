import { Global, Module } from "@nestjs/common";
import { TemplateAdminService } from "./template-admin.service.js";
import { TemplateAuditService } from "./template-audit.service.js";
import { TemplateService } from "./template.service.js";

@Global()
@Module({
  providers: [TemplateService, TemplateAdminService, TemplateAuditService],
  exports: [TemplateService, TemplateAdminService, TemplateAuditService],
})
export class TemplateModule {}
