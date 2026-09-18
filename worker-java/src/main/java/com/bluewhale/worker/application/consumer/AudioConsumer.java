package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.entity.GenerationMqRoute;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * 音频消费者（rocketmq-audio.consumer.ts 移植）。
 * <p>
 * tag = {@link GenerationMqRoute#AUDIO}，digitGuard = true（音频/图片做纯数字守卫）。
 * consumer group = "generation-audio-worker"。
 * <p>
 * 与 TS 行为完全一致：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(AUDIO_CONCURRENCY, default 5) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非纯数字 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class AudioConsumer extends AbstractGenerationConsumer {

    /** tag（{@link GenerationMqRoute#AUDIO}；= TS {@code AUDIO_GENERATION_TAG}）。 */
    private static final String TAG = GenerationMqRoute.AUDIO.tag();

    /**
     * 音频做 digitGuard（rocketmq-audio.consumer.ts:143-144）：
     * typeof body.jobId === "string" 且 /^\d+$/.test(jobId)。
     */
    private static final boolean DIGIT_GUARD = true;

    public AudioConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
