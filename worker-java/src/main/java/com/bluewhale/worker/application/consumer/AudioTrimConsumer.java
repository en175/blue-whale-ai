package com.bluewhale.worker.application.consumer;

import com.bluewhale.worker.application.processor.JobProcessor;
import com.bluewhale.worker.domain.contract.GenerationMqRouteEnum;
import org.apache.rocketmq.client.apis.ClientConfiguration;

/**
 * audio_trim（音频截取）消费者（IKHB6S，父单 IKHB08；MediaExtractConsumer 同款模板）。
 * <p>
 * tag = {@link GenerationMqRouteEnum#AUDIO_TRIM}，digitGuard = false（不套纯数字守卫，
 * 与 media_extract 一致——只查 typeof body.jobId === "string"）。
 * consumer group = "generation-audio-trim-worker"。
 * <p>
 * 行为与家族完全一致：
 * <ul>
 *   <li>receive(10, 30s) → Semaphore(并发度) → fire-and-forget</li>
 *   <li>毒丸：body 不可解析或 jobId 非字符串 → ack 丢弃</li>
 *   <li>handler 抛错 → 不 ack 不 nack（broker 30s 重投）</li>
 * </ul>
 */
public class AudioTrimConsumer extends AbstractGenerationConsumer {

    /** tag（{@link GenerationMqRouteEnum#AUDIO_TRIM}；= TS {@code AUDIO_TRIM_TAG}）。 */
    private static final String TAG = GenerationMqRouteEnum.AUDIO_TRIM.tag();

    /**
     * audio_trim 不做 digitGuard（MediaExtractConsumer 同款）：
     * 仅 typeof body.jobId === "string" 检查，不要求纯数字。
     */
    private static final boolean DIGIT_GUARD = false;

    public AudioTrimConsumer(
            JobProcessor processor,
            String topic,
            ClientConfiguration clientConfig,
            String consumerGroup,
            int concurrency
    ) {
        super(TAG, DIGIT_GUARD, processor, concurrency, topic, clientConfig, consumerGroup);
    }
}
