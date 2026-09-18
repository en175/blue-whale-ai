package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * media_extract 消费者（rocketmq-extract.consumer.ts 移植）。
 * <p>
 * tag = {@link GenerationMqRoute#MEDIA_EXTRACT}，digitGuard = false（extract 不做纯数字守卫）。
 * consumer group = "generation-extract-worker"。
 * <p>
 * 与 TS 行为完全一致：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(MEDIA_EXTRACT_CONCURRENCY) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非字符串 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class MediaExtractConsumer extends AbstractGenerationConsumer {

    /** tag（{@link GenerationMqRoute#MEDIA_EXTRACT}；queue.constants.ts:8 MEDIA_EXTRACT_TAG）。 */
    private static final String TAG = GenerationMqRoute.MEDIA_EXTRACT.tag();

    /**
     * extract 不做 digitGuard（rocketmq-extract.consumer.ts:143-144）：
     * 仅 typeof body.jobId === "string" 检查，不要求纯数字。
     */
    private static final boolean DIGIT_GUARD = false;

    public MediaExtractConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
