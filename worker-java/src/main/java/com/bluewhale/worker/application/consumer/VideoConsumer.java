package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * 视频消费者（rocketmq-video.consumer.ts 逐字移植）。
 * <p>
 * 收敛到 {@link AbstractGenerationConsumer} 模板（刀③ 去重）：视频与 image/audio/extract
 * 的差异只剩「顺序派发」——用并发度 1 的 Semaphore 表达（契约 §1：video for-await 顺序；
 * 其余 Semaphore(20/5/2) fire-and-forget）。并发度 1 时模板的 dispatch 仍经 fire-and-forget，
 * 但 acquire/release 全程互斥，等效顺序，且 receive→dispatch 的提交粒度不变。
 * <p>
 * 不做 digitGuard（视频 TS :78-83 仅检查 typeof body.jobId === "string"）。
 * <p>
 * 每条视频消息驱动一个 claim→submit/poll→scheduleNext 步骤；
 * 下一个 5s 延迟消息由 processor 自投到同一 topic/tag。
 */
public class VideoConsumer extends AbstractGenerationConsumer {

    /** tag = {@link GenerationMqRoute#VIDEO}（与 {@code generation_jobs.type} 同名；修正六由 "step" 更名）。 */
    public static final String TAG = GenerationMqRoute.VIDEO.tag();

    /** 视频顺序派发（并发度 1 ≈ TS for-await；契约 §1）。 */
    private static final int SEQUENTIAL_CONCURRENCY = 1;

    public VideoConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup
    ) {
        super(TAG, false, processor, SEQUENTIAL_CONCURRENCY, topic, clientConfig, consumerGroup);
    }
}
