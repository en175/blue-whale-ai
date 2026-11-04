import { Module } from "@nestjs/common";
import { ProjectCreateLock } from "@lib/shared/project/project-create-lock.js";

import { ProjectsController } from "./projects.controller.js";

@Module({
  controllers: [ProjectsController],
  providers: [ProjectCreateLock],
})
export class ProjectsApiModule {}
