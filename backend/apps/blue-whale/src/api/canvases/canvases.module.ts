import { Module } from "@nestjs/common";
import { CanvasesController } from "./canvases.controller.js";
import { LocalCanvasRecoveryController } from "./local-canvas-recovery.controller.js";
import { LocalCanvasRecoveryService } from "@lib/shared/canvas/local-canvas-recovery.service.js";

@Module({
  controllers: [CanvasesController, LocalCanvasRecoveryController],
  providers: [LocalCanvasRecoveryService],
})
export class CanvasApiModule {}
