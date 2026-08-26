import { Module } from "@nestjs/common";
import { MaterialService } from "./material.service.js";

@Module({
  providers: [MaterialService],
  exports: [MaterialService],
})
export class MaterialModule {}
