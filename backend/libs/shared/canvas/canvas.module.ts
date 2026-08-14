import { Global, Module } from "@nestjs/common";
import { CanvasService } from "./canvas.service.js";

@Global()
@Module({
  providers: [CanvasService],
  exports: [CanvasService],
})
export class CanvasModule {}
