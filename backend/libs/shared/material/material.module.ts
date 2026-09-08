import { Module } from "@nestjs/common";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { MaterialService } from "./material.service.js";

@Module({
  imports: [PrismaModule],
  providers: [MaterialService],
  exports: [MaterialService],
})
export class MaterialModule {}
