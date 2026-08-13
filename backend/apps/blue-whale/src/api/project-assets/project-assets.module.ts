import { Module } from "@nestjs/common";
import { ProjectAssetsController } from "./project-assets.controller.js";

@Module({
  controllers: [ProjectAssetsController],
})
export class ProjectAssetsModule {}
