import { Global, Module } from "@nestjs/common";
import { ProjectService } from "./project.service.js";

@Global()
@Module({
  providers: [ProjectService],
  exports: [ProjectService],
})
export class ProjectModule {}
