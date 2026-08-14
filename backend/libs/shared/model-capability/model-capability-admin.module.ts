import { Global, Module } from "@nestjs/common";
import { ModelAuditService } from "./model-audit.service.js";
import { ModelCapabilityAdminService } from "./model-capability-admin.service.js";

@Global()
@Module({
  providers: [ModelCapabilityAdminService, ModelAuditService],
  exports: [ModelCapabilityAdminService, ModelAuditService],
})
export class ModelCapabilityAdminModule {}
