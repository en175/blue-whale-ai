import { Module } from "@nestjs/common";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { MaterialController } from "./material.controller.js";

@Module({
  controllers: [MaterialController],
  providers: [MaterialService],
})
export class MaterialApiModule {}
