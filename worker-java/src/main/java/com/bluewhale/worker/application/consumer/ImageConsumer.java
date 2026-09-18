package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * 图片消费者（rocketmq-image.consumer.ts 移植）。
 * <p>
 * tag = {@link GenerationMqRoute#IMAGE}，digitGuard = true（图片/音频做纯数字守卫，与 TS :147-169 一致）。
 * consumer group = "generation-image-worker"。
 * <p>
 * 与 TS 行为完全一致：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(IMAGE_CONCURRENCY, default 20) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class ImageConsumer extends AbstractGenerationConsumer {

    /** tag（{@link GenerationMqRoute#IMAGE}；= TS {@code IMAGE_GENERATION_TAG}）。 */
    private static final String TAG = GenerationMqRoute.IMAGE.tag();

    /**
     * 图片做 digitGuard（rocketmq-image.consumer.ts:147-148）：
     * typeof body.jobId === "string" 且 /^\d+$/.test(jobId)。
     */
    private static final boolean DIGIT_GUARD = true;

    public ImageConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
