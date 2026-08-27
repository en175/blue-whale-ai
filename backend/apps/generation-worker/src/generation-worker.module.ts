import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { loadRedisConnection } from "@lib/shared/generation/video-queue.js";
import { VIDEO_GENERATION_QUEUE } from "@lib/shared/generation/queue.constants.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { GenerationVideoProcessor } from "./generation-video.processor.js";
import { HealthController } from "./health.controller.js";
import { RecoveryService } from "./recovery.service.js";
import { RocketMqVideoConsumer } from "./rocketmq-video.consumer.js";
import { RocketMqMediaExtractConsumer } from "./rocketmq-extract.consumer.js";
import { RocketMqImageConsumer } from "./rocketmq-image.consumer.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";
import { ImageWorkerService } from "./image-worker.service.js";

/** 唤醒消费者按 VIDEO_QUEUE_DRIVER 选择：
 *  - rocketmq（默认）：RocketMqVideoConsumer（tag=step）+ RocketMqMediaExtractConsumer（tag=media_extract）
 *    + RocketMqImageConsumer（tag=image，IKBGKA，Semaphore(IMAGE_CONCURRENCY)）
 *  - bullmq：BullModule + GenerationVideoProcessor（Redis 回退，按 job.name 分发 step/media_extract）
 *  与 producer 侧 enqueueVideoGenerationJob / enqueueMediaExtractJob / enqueueImageGenerationJob 的 driver 选择保持一致。 */
const driver = process.env.VIDEO_QUEUE_DRIVER ?? "rocketmq";
const useBullmq = driver === "bullmq";

@Module({
  imports: [
    PrismaModule,
    ScheduleModule.forRoot(),
    ...(useBullmq
      ? [
          BullModule.forRoot({
            connection: loadRedisConnection(process.env, true),
          }),
          BullModule.registerQueue({ name: VIDEO_GENERATION_QUEUE }),
        ]
      : []),
  ],
  controllers: [HealthController],
  providers: [
    VideoWorkerService,
    MediaExtractWorkerService,
    ImageWorkerService,
    RecoveryService,
    ...(useBullmq
      ? [GenerationVideoProcessor]
      : [
          RocketMqVideoConsumer,
          RocketMqMediaExtractConsumer,
          RocketMqImageConsumer,
        ]),
  ],
})
export class GenerationWorkerModule {}
