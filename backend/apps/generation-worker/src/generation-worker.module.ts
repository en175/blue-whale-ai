import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { loadRedisConnection } from "@lib/shared/generation/video-queue.js";
import { VIDEO_GENERATION_QUEUE } from "@lib/shared/generation/queue.constants.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { GenerationVideoProcessor } from "./generation-video.processor.js";
import { HealthController } from "./health.controller.js";
import { RecoveryService } from "./recovery.service.js";
import { VideoWorkerService } from "./video-worker.service.js";

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: loadRedisConnection(process.env, true),
    }),
    BullModule.registerQueue({ name: VIDEO_GENERATION_QUEUE }),
  ],
  controllers: [HealthController],
  providers: [VideoWorkerService, GenerationVideoProcessor, RecoveryService],
})
export class GenerationWorkerModule {}
