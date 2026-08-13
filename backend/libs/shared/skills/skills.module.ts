import { Global, Module } from "@nestjs/common";
import { SkillService } from "./skills.service.js";

@Global()
@Module({
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}
