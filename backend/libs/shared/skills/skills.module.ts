import { Global, Module } from "@nestjs/common";
import { SkillAdminService } from "./skill-admin.service.js";
import { SkillService } from "./skills.service.js";

@Global()
@Module({
  providers: [SkillService, SkillAdminService],
  exports: [SkillService, SkillAdminService],
})
export class SkillModule {}
