import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { VIDEO_GENERATION_QUEUE } from "@lib/shared/generation/queue.constants.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { AssetModule } from "@lib/shared/assets/assets.module.js";
import { OperationLogModule } from "@lib/shared/operation-log/operation-log.module.js";
import { HealthController } from "./health.controller.js";
import { RecoveryService } from "./recovery.service.js";
import { RocketMqVideoConsumer } from "./rocketmq-video.consumer.js";
import { RocketMqMediaExtractConsumer } from "./rocketmq-extract.consumer.js";
import { RocketMqImageConsumer } from "./rocketmq-image.consumer.js";
import { RocketMqAudioConsumer } from "./rocketmq-audio.consumer.js";
import { VideoWorkerService } from "./video-worker.service.js";
import { MediaExtractWorkerService } from "./media-extract-worker.service.js";
import { ImageWorkerService } from "./image-worker.service.js";
import { AudioWorkerService } from "./audio-worker.service.js";
import { AssetGcService } from "./asset-gc.service.js";

/** 唤醒消费者统一走 RocketMQ：RocketMqVideoConsumer（tag=step）+ RocketMqMediaExtractConsumer（tag=media_extract）
 *  + RocketMqImageConsumer（tag=image，IKBGKA，Semaphore(IMAGE_CONCURRENCY)）
 *  + RocketMqAudioConsumer（tag=audio，IKCR78，Semaphore(AUDIO_CONCURRENCY)）
 *  producer 侧 enqueueVideoGenerationJob / enqueueMediaExtractJob / enqueueImageGenerationJob
 *  / enqueueAudioGenerationJob 同走 RocketMQ（IKDZJK：收敛为 rocketmq 唯一驱动）。 */
@Module({
  imports: [
    PrismaModule,
    AssetModule,
    OperationLogModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController],
  providers: [
    VideoWorkerService,
    MediaExtractWorkerService,
    ImageWorkerService,
    AudioWorkerService,
    RecoveryService,
    AssetGcService,
    RocketMqVideoConsumer,
    RocketMqMediaExtractConsumer,
    RocketMqImageConsumer,
    RocketMqAudioConsumer,
  ],
})
export class GenerationWorkerModule {}
